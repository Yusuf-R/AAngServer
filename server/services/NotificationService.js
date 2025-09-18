// Core Notification Service - The brain of your notification system
import Notification from '../models/Notification';
import {EventEmitter} from 'events';
import SocketEmitter from "../utils/socketEmitter";

/**
 * Core Notification Service that extends EventEmitter
 * This allows the service to both emit and listen to events
 */
class NotificationService extends EventEmitter {
    constructor() {
        super(); // Enables event-based logic using EventEmitter
        this.templates = new Map(); // Stores predefined notification templates (e.g. password changed)
        this.deliveryProviders = new Map(); // For future integrations: SMS, Email, Push providers
        this.rules = new Map(); // Holds delivery rules (e.g. delay low priority at night)
        this.init(); // Bootstraps the system
    }

    init() {
        this.loadTemplates(); // Load all static templates
        this.loadDeliveryRules(); // Load rules for controlling delivery behavior
        this.setupEventListeners(); // Setup real-time listeners for app-specific events
    }

    // ------------------ TEMPLATES ------------------
    /**
     * Order Created Template
     * Used when a new order is placed
     * @example {orderId} gets replaced with actual order number
     */
    loadTemplates() {
        this.templates.set('order.created', {
            title: '🎉 Order Created Successfully!',
            body: 'Your order {orderId} has been created and is being processed.',
            orderRef: '{orderId}',
            priority: 'NORMAL',
            channels: { push: true, inApp: true },
            actionButtons: [
                { label: 'Track Order', action: 'track', deepLink: '/client/orders/track' },
                { label: 'View Details', action: 'view', deepLink: '/client/orders/view' }
            ]
        });

        // delivery
        this.templates.set('delivery.driver_assigned', {
            title: '🚚 Driver Assigned!',
            body: '{driverName} will pick up your order. ETA: {estimatedTime}',
            priority: 'HIGH',
            channels: { push: true, inApp: true, sms: true },
            actionButtons: [
                { label: 'Track Live', action: 'track', deepLink: '/tracking/track' },
                { label: 'Contact Driver', action: 'call', deepLink: 'tel:{driverPhone}' }
            ]
        });

        // Payment
        // Failed Payment Template
        this.templates.set('payment.failed', {
            title: '⚠️ Payment Failed',
            body: 'Your payment for order {orderId} failed. Please check and try again.',
            orderRef: '{orderId}',
            priority: 'URGENT',
            channels: { push: true, inApp: true, email: true },
        });

        // Successful Payment Template
        this.templates.set('payment.successful', {
            title: '✅ Payment Successful',
            body: 'Your payment for order {orderId} was successful. Thank you!',
            orderRef: '{orderId}',
            amountPaid: '{totalAmount}',
            priority: 'NORMAL',
            channels: { push: true, inApp: true, email: true },
        });


        // profile
        this.templates.set('identity.complete_profile_reminder', {
            title: '📋 Complete Your Profile',
            body: 'Complete your profile to unlock faster deliveries and better rates!',
            priority: 'LOW',
            channels: { push: true, inApp: true },
            actionButtons: [
                { label: 'Complete Now', action: 'navigate', deepLink: '/profile/complete' },
                { label: 'Later', action: 'dismiss' }
            ]
        });

        // Password-related templates
        this.templates.set('security.password_changed', {
            title: '🔒 Password Changed',
            body: 'You successfully updated your password.',
            priority: 'HIGH',
            channels: { push: true, inApp: true },
        });

        // PIN-related templates
        this.templates.set('security.pin_updated', {
            title: '🔐 PIN Updated',
            body: 'Your PIN was updated successfully. If this wasn’t you, contact support.',
            priority: 'HIGH',
            channels: { push: true, inApp: true },
        });

        this.templates.set('security.pin_set', {
            title: '🔐 PIN Set',
            body: 'Your PIN has been successfully set. If this wasn’t you, contact support.',
            priority: 'HIGH',
            channels: { push: true, inApp: true },
        });

        this.templates.set('security.pin_reset', {
            title: '🔐 PIN Reset',
            body: 'Your PIN has been successfully reset. If this wasn’t you, contact support.',
            priority: 'HIGH',
            channels: { push: true, inApp: true },
        });

        this.templates.set('security.pin_requested', {
            title: '🔐 PIN Change Requested',
            body: 'You requested to change your PIN. Check your email for the verification code.',
            priority: 'HIGH',
            channels: { push: true, inApp: true },
        });
    }

    // ------------------ RULES ------------------
    /**
     * Night Quiet Hours Rule
     * Prevents low-priority notifications between 10PM-7AM
     */
    loadDeliveryRules() {
        // Rule: Don't send low priority notifications during night hours
        this.rules.set('night_quiet_hours', {
            condition: (notification, user) => {
                const hour = new Date().getHours();
                return notification.priority === 'LOW' && (hour >= 22 || hour <= 7);
            },
            action: 'delay',
            delayUntil: () => {
                const tomorrow = new Date();
                tomorrow.setDate(tomorrow.getDate() + 1);
                tomorrow.setHours(8, 0, 0, 0);
                return tomorrow;
            }
        });

        // Rule: Batch promotional notifications
        this.rules.set('batch_promotions', {
            condition: (notification) => notification.category === 'PROMOTION',
            action: 'batch',
            batchWindow: 4 * 60 * 60 * 1000, // 4 hours
            maxBatchSize: 3
        });

        // Rule: Emergency notifications bypass all rules
        this.rules.set('emergency_bypass', {
            condition: (notification) => notification.priority === 'CRITICAL',
            action: 'immediate'
        });
    }

    // ------------------ EVENT LISTENERS ------------------
    /**
     * Order Created Event
     * Listens for order creation and triggers notification
     */
    setupEventListeners() {
        // Listen for order events
        this.on('order.created', (orderData) => {
            this.createNotification({
                userId: orderData.userId,
                type: 'order.created',
                metadata: { orderId: orderData._id },
                templateData: { orderId: orderData.orderNumber }
            });
        });

        this.on('delivery.driver_assigned', (data) => {
            this.createNotification({
                userId: data.userId,
                type: 'delivery.driver_assigned',
                metadata: {
                    orderId: data.orderId,
                    driverId: data.driverId
                },
                templateData: {
                    driverName: data.driverName,
                    estimatedTime: data.estimatedTime,
                    driverPhone: data.driverPhone
                }
            });
        });

        // Add more event listeners...
    }

    // ------------------ NOTIFICATION CREATION ------------------
    /**
     * Create a new notification
     * This method handles the entire notification creation process:
     * 1. Validates parameters
     * 2. Interpolates templates
     * 3. Applies delivery rules
     * @param params
     * @returns {Promise<any>}
     *
     */
    async createNotification(params) {
        try {
            // Destructure parameters with defaults
            const {
                userId,          // Required: Recipient user ID
                type,            // Required: Notification type (template key)
                metadata = {},   // Additional metadata
                templateData = {}, // Data for template interpolation
                customContent = null, // Override template
                priority = null, // Override template priority
                scheduleFor = null // Schedule delivery for future
            } = params;

            // Get template or use custom content
            const template = customContent || this.templates.get(type);
            if (!template) {
                throw new Error(`No template found for notification type: ${type}`);
            }

            // Extract category from type (e.g., 'order.created' → 'ORDER')
            const category = type.split('.')[0].toUpperCase();

            // Build notification object
            const notificationData = {
                userId,
                category,
                type,
                priority: priority || template.priority || 'NORMAL',
                content: {
                    // Replace template placeholders with actual data
                    title: this.interpolateTemplate(template.title, templateData),
                    body: this.interpolateTemplate(template.body, templateData),
                    orderRef: this.interpolateTemplate(template.orderRef || '', templateData),
                    amountPaid: this.interpolateTemplate(template.amountPaid || '', templateData),
                    richContent: {
                        // Process action buttons with deep links
                        actionButtons: template.actionButtons?.map(button => ({
                            ...button,
                            deepLink: this.interpolateTemplate(button.deepLink || '', templateData)
                        })) || []
                    }
                },
                metadata: {
                    ...metadata,
                    channels: template.channels || { push: true, inApp: true },
                    deliveryTiming: {
                        immediate: !scheduleFor,
                        scheduledFor: scheduleFor,
                        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
                    },
                    source: 'system',
                    interactions: [] // Track user interactions
                },
                status: 'PENDING'
            };

            const processed = await this.applyDeliveryRules(notificationData);

            const notification = new Notification(processed);
            await notification.save();

            // 👇 Only in-app (real-time) notifications are sent via socket here
            if (processed.metadata.deliveryTiming.immediate && processed.metadata?.channels?.inApp !== false) {
                SocketEmitter.emitToUser(notification.userId, 'notification', notification.toObject());
            }

            // Trigger full delivery pipeline (SMS, email, etc.)
            if (processed.metadata.deliveryTiming.immediate) {
                await this.deliverNotification(notification);
            }

            return notification;

        } catch (error) {
            console.error('Error creating notification:', error);
            throw error;
        }
    }

    // Apply intelligent delivery rules
    async applyDeliveryRules(notificationData) {
        let processedNotification = { ...notificationData };

        // Check each rule
        for (const [ruleName, rule] of this.rules) {
            if (rule.condition(processedNotification)) {
                switch (rule.action) {
                    case 'delay':
                        processedNotification.metadata.deliveryTiming.immediate = false;
                        processedNotification.metadata.deliveryTiming.scheduledFor = rule.delayUntil();
                        break;

                    case 'immediate':
                        processedNotification.metadata.deliveryTiming.immediate = true;
                        processedNotification.metadata.deliveryTiming.scheduledFor = null;
                        break;

                    case 'batch':
                        // Handle batching logic
                        processedNotification = await this.handleBatching(processedNotification, rule);
                        break;
                }
            }
        }

        return processedNotification;
    }

    // Template interpolation for dynamic content
    interpolateTemplate(template, data) {
        if (!template) return '';
        return template.replace(/\{(\w+)\}/g, (match, key) => data[key] || match);
    }

    // Deliver notification through appropriate channels
    /**
     * Deliver a notification through all configured channels
     * This method handles:
     * 1. In-app delivery
     * 2. Push notifications
     * 3. Email notifications
     * 4. SMS notifications
     * @param notification
     * @returns {Promise<void>}
     */
    async deliverNotification(notification) {
        try {
            const channels = notification.metadata.channels;

            // In-app notification (always delivered first)
            if (channels.inApp) {
                notification.status = 'DELIVERED';
                notification.deliveredAt = new Date();
                await notification.save();
            }

            // Push notification
            if (channels.push) {
                await this.sendPushNotification(notification);
            }

            // Email notification
            if (channels.email) {
                await this.sendEmailNotification(notification);
            }

            // SMS notification
            if (channels.sms) {
                await this.sendSMSNotification(notification);
            }

            // Update status
            notification.status = 'SENT';
            notification.sentAt = new Date();
            await notification.save();

            // Emit delivery event for analytics
            this.emit('notification.delivered', notification);

        } catch (error) {
            console.error('Error delivering notification:', error);
            notification.status = 'FAILED';
            notification.metadata.retryCount += 1;
            await notification.save();

            // Retry logic
            if (notification.metadata.retryCount < notification.metadata.maxRetries) {
                setTimeout(() => {
                    this.deliverNotification(notification);
                }, Math.pow(2, notification.metadata.retryCount) * 1000); // Exponential backoff
            }
        }
    }

    // Placeholder methods for different delivery channels
    async sendPushNotification(notification) {
        // Implement with Firebase, OneSignal, etc.
        console.log('Sending push notification:', notification.content.title);
    }

    async sendEmailNotification(notification) {
        // Implement with SendGrid, AWS SES, etc.
        console.log('Sending email notification:', notification.content.title);
    }

    async sendSMSNotification(notification) {
        // Implement with Twilio, AWS SNS, etc.
        console.log('Sending SMS notification:', notification.content.title);
    }

    // ------------------ QUERIES ------------------
    // Get notifications for a user with intelligent filtering
    /**
     * Fetch user notifications with optional filters
     * @param userId - User ID to fetch notifications for
     * @param options - Filtering options (category, unreadOnly, priority, limit, offset)
     * @returns {Promise<Array>} - Array of notifications
     */
    async getUserNotifications( userId, options = {} ) {
        const {
            limit = 20,
            offset = 0
        } = options;

        const query = {
            userId,
            'deleted.status': false
        };

        return Notification.find(query)
            .sort({priority: -1, createdAt: -1})
            .limit(limit)
            .skip(offset)
            .lean();
    }

    // Get notification statistics
    /**
     * Get notification statistics for a user
     * This includes:
     * - Total notifications
     * - Unread notifications
     * - Count by category
     * - Count by priority
     * @param userId - User ID to fetch stats for
     * @returns {Promise<{total: number | Array<any>, unread: number | Array<any>, byCategory: T | any, byPriority: T | any}>}
     */
    async getNotificationStats(userId) {
        const [total, unread, byCategory, byPriority] = await Promise.all([
            Notification.countDocuments({ userId, 'deleted.status': false }),
            Notification.countDocuments({ userId, 'read.status': false, 'deleted.status': false }),
            Notification.aggregate([
                { $match: { userId, 'deleted.status': false } },
                { $group: { _id: '$category', count: { $sum: 1 } } }
            ]),
            Notification.aggregate([
                { $match: { userId, 'read.status': false, 'deleted.status': false } },
                { $group: { _id: '$priority', count: { $sum: 1 } } }
            ])
        ]);

        return {
            total,
            unread,
            byCategory: byCategory.reduce((acc, item) => {
                acc[item._id] = item.count;
                return acc;
            }, {}),
            byPriority: byPriority.reduce((acc, item) => {
                acc[item._id] = item.count;
                return acc;
            }, {})
        };
    }

    // Bulk operations
    /**
     * Mark all notifications as read for a user
     * This updates all unread notifications to read status
     * @param userId - User ID to mark notifications for
     * @param category - Optional category filter to apply
     * @param {string|null} category - Category to filter notifications by
     * @param {string} userId - User ID to mark notifications for
     * @returns {Promise<Query<UpdateResult<Document>, THydratedDocumentType, TQueryHelpers, TRawDocType, "updateMany", TInstanceMethods & TVirtuals> & TQueryHelpers>}
     */
    async markAllAsRead(userId, category = null) {
        const query = { userId, 'read.status': false };
        if (category) query.category = category;

        return Notification.updateMany(query, {
            'read.status': true,
            'read.readAt': new Date(),
            status: 'READ'
        });
    }

    // Delete operations
    /**
     * Soft delete a notification
     * This marks the notification as deleted without removing it from the database
     * * @param notificationId - ID of the notification to delete
     * @returns {Promise<*>}
     */
    async deleteNotification(notificationId) {
        const notification = await Notification.findById(notificationId);
        if (!notification) throw new Error('Notification not found');

        // Soft delete
        notification.deleted.status = true;
        notification.deleted.deletedAt = new Date();
        return await notification.save();
    }

    // Get Unread Count
    /**
     * Get the count of unread notifications for a user
     * @param userId - User ID to fetch unread count for
     * @returns {Promise<number>} - Count of unread notifications
     */
    async getUnreadCount(userId) {
        return Notification.countDocuments({
            userId,
            'read.status': false,
            'deleted.status': false
        });
    }

    /**
     * Delete all notifications for a user
     * This marks all notifications as deleted for a specific user
     * @param {string} userId - User ID to delete notifications for
     * @returns {Promise<Query<UpdateResult<Document>, THydratedDocumentType, TQueryHelpers, TRawDocType, "updateMany", TInstanceMethods & TVirtuals> & TQueryHelpers>}
     */
    async deleteAllNotifications(userId) {
        return Notification.updateMany(
            { userId, 'deleted.status': false },
            {
                'deleted.status': true,
                'deleted.deletedAt': new Date()
            }
        );
    }

    // ------------------ NOTIFICATION DELIVERY ------------------
    /**
     * Send a notification immediately
     * This method is used to trigger the delivery of a specific notification
     * @param notificationId - ID of the notification to send
     * @returns {Promise<Notification>}
     */
    async sendNotification(notificationId) {
        const notification = await Notification.findById(notificationId);
        if (!notification) throw new Error('Notification not found');

        // Check if already sent
        if (notification.status === 'SENT') {
            console.log('Notification already sent:', notificationId);
            return notification;
        }

        // Deliver the notification
        await this.deliverNotification(notification);
        return notification;
    }

    // ------------------ CLEANUP OPERATIONS ------------------
    /**
     * Cleanup old notifications
     * This method deletes notifications that are older than a specified number of days
     * * @param {number} daysOld - Number of days old notifications to delete
     * @returns {Promise<awaited Query<DeleteResult, THydratedDocumentType, TQueryHelpers, TRawDocType, "deleteMany", TInstanceMethods & TVirtuals> & TQueryHelpers>}
     */

    async cleanupOldNotifications(daysOld = 30) {
        const cutoffDate = new Date();templates
        cutoffDate.setDate(cutoffDate.getDate() - daysOld);

        // Delete read, low/normal priority notifications older than X days
        return Notification.deleteMany({
            createdAt: {$lt: cutoffDate},
            priority: {$in: ['LOW', 'NORMAL']},
            'read.status': true
        });
    }

}

export default new NotificationService();
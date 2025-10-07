// /services/ExpoPushService.js (Node.js BE)
import Expo from "expo-server-sdk"
import NotificationService from "./NotificationService";
import getModels from "../models/AAng/AAngLogistics"

class ExpoPushService {
    constructor() {
        this.expo = new Expo();
        this.chunkSize = 100;
    }

    /**
     * Send push notification using your existing NotificationService
     */
    async sendPushToDriver(driverId, order, assignmentId) {
        const { Driver } = await getModels();
        try {
            // const driver = await Driver.findById(driverId).select('expoPushToken fullName');
            const driver = await Driver.findOne({
                _id: driverId,
                expoPushToken: { $exists: true },
                'pushTokenStatus.valid': true,
            }).select('expoPushToken fullName');

            if (!driver || !driver.expoPushToken || !Expo.isExpoPushToken(driver.expoPushToken)) {
                return { success: false, error: 'Invalid driver or push token' };
            }

            // Use your existing NotificationService to create the notification
            const notification = await NotificationService.createNotification({
                userId: driverId,
                type: 'delivery.driver_assigned', // Using your existing type
                metadata: {
                    orderId: order._id,
                    orderRef: order.orderRef,
                    driverId: driverId,
                    assignmentId: assignmentId,
                    channels: {
                        push: true,
                        inApp: true, // This will trigger your existing SocketEmitter
                        sms: false,
                        email: false
                    }
                },
                templateData: {
                    driverName: driver.fullName,
                    estimatedTime: this.calculateETA(order, driver),
                    orderId: order.orderRef,
                    totalAmount: order.pricing.totalAmount,
                    pickupLandmark: order.location.pickUp.landmark,
                    dropoffLandmark: order.location.dropOff.landmark
                }
            });

            // Now send the actual Expo push notification
            const message = {
                to: driver.expoPushToken,
                sound: 'default',
                title: '📦 New Delivery Available',
                body: 'Tap to view order details',
                data: {
                    deepLink: `aanglogistics://orders/${order._id}`
                },
                channelId: 'order-alerts',
                priority: 'high',
                badge: 1,
            };

            const tickets = await this.expo.sendPushNotificationsAsync([message]);
            await this.handlePushTicket(tickets[0], driverId, order._id, notification._id);

            console.log(`✅ Push sent to ${driver.fullName}`);
            return { success: true, notification, ticket: tickets[0] };

        } catch (error) {
            console.error(`❌ Push failed for driver ${driverId}:`, error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Bulk push using your notification system
     */
    async sendBulkPushNotifications(drivers, order, assignmentId) {
        try {
            const results = [];

            for (const driverData of drivers) {
                try {
                    const result = await this.sendPushToDriver(
                        driverData.driverId,
                        order,
                        assignmentId
                    );
                    results.push(result);
                } catch (driverError) {
                    console.error(`Failed for driver ${driverData.driverId}:`, driverError);
                    results.push({
                        success: false,
                        driverId: driverData.driverId,
                        error: driverError.message
                    });
                }
            }

            const successful = results.filter(r => r.success).length;
            console.log(`✅ Bulk push completed: ${successful}/${drivers.length} successful`);

            return {
                success: successful > 0,
                total: drivers.length,
                successful,
                failed: drivers.length - successful,
                results
            };

        } catch (error) {
            console.error('❌ Bulk push failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Calculate ETA for notification template
     */
    calculateETA(order, driver) {
        // You can implement your ETA logic here
        // For now, return a simple estimate
        return '15-20 mins';
    }

    /**
     * Handle push ticket and update notification status
     */
    async handlePushTicket(ticket, driverId, orderId, notificationId) {
        try {
            if (ticket.status === 'error') {
                console.error(`Push error for driver ${driverId}:`, ticket.details);

                // Update notification status to failed
                await Notification.findByIdAndUpdate(notificationId, {
                    status: 'FAILED',
                    'metadata.deliveryError': ticket.details?.error
                });

                // Handle specific Expo errors
                if (ticket.details?.error === 'DeviceNotRegistered') {
                    await this.markTokenInvalid(driverId);
                }
            } else {
                // Update notification status to sent
                await Notification.findByIdAndUpdate(notificationId, {
                    status: 'SENT',
                    sentAt: new Date()
                });
            }
        } catch (error) {
            console.error('Error handling push ticket:', error);
        }
    }

    async markTokenInvalid(driverId) {
        const { Driver } = await getModels();
        await Driver.findByIdAndUpdate(driverId, {
            $unset: { expoPushToken: 1 }
        });
        console.log(`🗑️ Marked push token as invalid for driver ${driverId}`);
    }
}

module.exports = new ExpoPushService();
// Enhanced Notification Schema with deep categorization and intelligence
import mongoose from "mongoose";
const {Schema, model} = mongoose;

const NotificationSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Base',
        required: true,
        index: true, // For faster queries
    },

    // Enhanced categorization system
    category: {
        type: String,
        enum: [
            'ORDER',      // Order-related notifications
            'DELIVERY',   // Delivery and tracking updates
            'SECURITY',   // Security-related notifications
            'IDENTITY',   // Profile and verification
            'SYSTEM',     // System messages and updates
            'PAYMENT',    // Payment and wallet notifications
            'SOCIAL',     // Messages, reviews, community
            'PROMOTION'   // Marketing and promotional content
        ],
        required: true,
        index: true,
    },

    // Detailed sub-type for granular control
    type: {
        type: String,
        enum: [
            // ORDER category
            'order.created', // when the process of the order is fully completed (always true after payment is successful)
            'order.confirmed', // when the order is confirmed by the admin
            'order.cancelled',
            'order.modified',

            // DELIVERY category
            'delivery.driver_assigned',
            'delivery.picked_up',
            'delivery.in_transit',
            'delivery.delivered',
            'delivery.failed',
            'delivery.delayed',
            'delivery.location_update',

            // SECURITY category
            'security.password_changed',
            'security.pin_set',
            'security.pin_reset',
            'security.pin_updated',
            'security.login_attempt',
            'security.device_login',
            'security.suspicious_activity',

            // IDENTITY category
            'identity.email_verified',
            'identity.phone_verified',
            'identity.profile_updated',
            'identity.kyc_approved',
            'identity.kyc_rejected',
            'identity.complete_profile_reminder',

            // Specific to Driver Document Verification
            'verification.document_submitted',
            'verification.document_verified',
            'verification.document_rejected',
            'verification.document_suspended',
            'verification.document_review',

            // SYSTEM category
            'system.maintenance',
            'system.update_available',
            'system.service_disruption',
            'system.new_feature',
            'system.announcement',

            // PAYMENT category
            'payment.successful',
            'payment.failed',
            'payment.refund_processed',
            'payment.wallet_topup',
            'payment.low_balance',

            // SOCIAL category
            'social.new_message',
            'social.driver_message',
            'social.review_received',
            'social.support_reply',

            // PROMOTION category
            'promotion.discount_available',
            'promotion.cashback_earned',
            'promotion.referral_bonus',
            'promotion.seasonal_offer'
        ],
        required: true,
        index: true,
    },

    // Priority system for intelligent handling
    priority: {
        type: String,
        enum: ['LOW', 'NORMAL', 'HIGH', 'URGENT', 'CRITICAL'],
        default: 'NORMAL',
        index: true,
    },

    // Rich content structure
    content: {
        title: {
            type: String,
            required: true,
            maxlength: 100,
        },
        body: {
            type: String,
            required: true,
            maxlength: 500,
        },
        orderRef: {
            type: String,
        },
        // For rich notifications with images, buttons, etc.
        richContent: {
            imageUrl: String,
            actionButtons: [{
                label: String,
                action: String,
                deepLink: String,
            }],
            customData: Object,
        }
    },

    // adminAction
    adminAction: {
        required: {
            type: Boolean,
            default: false,
            index: true,
            strictPopulate: false
        },

        // Type of admin action needed
        actionType: {
            type: String,
            enum: [
                'REVIEW',           // Requires review (e.g., driver docs, user reports)
                'APPROVE',          // Requires approval (e.g., verification, refunds)
                'ASSIGN',           // Requires assignment (e.g., order to driver)
                'RESOLVE',          // Requires resolution (e.g., disputes, issues)
                'ACKNOWLEDGE',      // Requires acknowledgment (e.g., critical alerts)
                'INVESTIGATE',      // Requires investigation (e.g., fraud, security)
                'CONFIGURE',        // Requires configuration (e.g., system settings)
                'RESPOND'           // Requires response (e.g., support tickets)
            ],
            default: null,
        },

        // Target admin role (if specific role required)
        targetRole: {
            type: String,
            enum: ["super_admin", "platform_manager", "operations_manager", "customer_support", "finance_manager", "compliance_officer"],
            default: 'super_admin',
        },

        // Priority urgency (distinct from notification priority)
        urgency: {
            type: String,
            enum: ['IMMEDIATE', 'TODAY', 'THIS_WEEK', 'WHENEVER'],
            default: 'WHENEVER',
        },

        // Action status tracking
        status: {
            type: String,
            enum: ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'REJECTED', 'ESCALATED'],
            default: 'PENDING',
            index: true,
        },

        // Who handled it
        handledBy: {
            adminId: {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'Base',
            },
            adminName: String,
            handledAt: Date,
        },

        // Action outcome
        outcome: {
            decision: String, // 'approved', 'rejected', 'deferred', etc.
            notes: String,
            completedAt: Date,
        },

        // SLA tracking
        sla: {
            dueAt: Date,
            isOverdue: {
                type: Boolean,
                default: false,
            },
            responseTime: Number, // In minutes
            resolutionTime: Number, // In minutes
        },

        // Related entity that triggered admin action
        relatedEntity: {
            type: {
                type: String,
                enum: [
                    'order',
                    'driver_verification',
                    'user_profile',
                    'payment',
                    'dispute',
                    'support_ticket',
                    'system_alert',
                    'report'
                ],
            },
            id: mongoose.Schema.Types.ObjectId,
            status: String, // Current status of the entity
        },
    },

    // Enhanced metadata for context and intelligence
    metadata: {
        // Related entity references
        orderId: mongoose.Schema.Types.ObjectId,
        orderRef: String,
        totalAmount: Number,
        status: String, // e.g., 'pending', 'confirmed', 'delivered'
        driverId: mongoose.Schema.Types.ObjectId,
        paymentId: mongoose.Schema.Types.ObjectId,
        gateway: String, // e.g., 'stripe', 'paypal, paystack'
        paymentData: {
            type: Schema.Types.Mixed,
            default: null
        },
        // Tracking and analytics
        source: String, // 'system', 'admin', 'auto-trigger'
        campaign: String, // For promotional notifications

        // Delivery preferences
        channels: {
            push: {type: Boolean, default: true},
            email: {type: Boolean, default: false},
            sms: {type: Boolean, default: false},
            inApp: {type: Boolean, default: true},
        },

        // Smart delivery timing
        deliveryTiming: {
            immediate: {type: Boolean, default: true},
            scheduledFor: Date,
            timezone: String,
        },

        // Interaction tracking
        interactions: [{
            action: String, // 'opened', 'clicked', 'dismissed'
            timestamp: {type: Date, default: Date.now},
            channel: String,
        }],

        // Expiry and lifecycle
        expiresAt: Date,
        retryCount: {type: Number, default: 0},
        maxRetries: {type: Number, default: 3},
    },

    // Status tracking
    status: {
        type: String,
        enum: ['PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'EXPIRED'],
        default: 'PENDING',
        index: true,
    },

    // Read status with timestamp
    read: {
        status: {type: Boolean, default: false},
        readAt: Date,
    },

    // Soft delete for data retention
    deleted: {
        status: {type: Boolean, default: false},
        deletedAt: Date,
    },

    // Timestamps
    createdAt: {type: Date, default: Date.now, index: true},
    updatedAt: {type: Date, default: Date.now},
    sentAt: Date,
    deliveredAt: Date,
});

// Compound indexes for efficient queries
NotificationSchema.index({userId: 1, createdAt: -1});
NotificationSchema.index({userId: 1, status: 1});
NotificationSchema.index({userId: 1, category: 1, createdAt: -1});
NotificationSchema.index({priority: 1, status: 1, createdAt: 1});
NotificationSchema.index({'metadata.orderId': 1, 'metadata.orderRef': 1});
NotificationSchema.index({
    'adminAction.required': 1,
    'adminAction.status': 1,
    'adminAction.urgency': -1,
    createdAt: -1
});

// Pre-save middleware to update timestamps
NotificationSchema.pre('save', function (next) {
    this.updatedAt = new Date();
    next();
});

// Virtual for checking if notification is actionable
NotificationSchema.virtual('isActionable').get(function () {
    return this.content.richContent?.actionButtons?.length > 0;
});

// Virtual for checking if expired
NotificationSchema.virtual('isExpired').get(function () {
    return this.metadata.expiresAt && this.metadata.expiresAt < new Date();
});

// Methods for common operations
NotificationSchema.methods.markAsRead = function () {
    this.read.status = true;
    this.read.readAt = new Date();
    this.status = 'READ';
    return this.save();
};

NotificationSchema.methods.addInteraction = function (action, channel = 'app') {
    this.metadata.interactions.push({
        action,
        channel,
        timestamp: new Date()
    });
    return this.save();
};

NotificationSchema.methods.softDelete = function () {
    this.deleted.status = true;
    this.deleted.deletedAt = new Date();
    return this.save();
};

// Static methods for intelligent querying
NotificationSchema.statics.getUnreadCount = function (userId) {
    return this.countDocuments({
        userId,
        'read.status': false,
        'deleted.status': false,
        status: {$in: ['SENT', 'DELIVERED']}
    });
};

NotificationSchema.statics.getByCategory = function (userId, category, limit = 20) {
    return this.find({
        userId,
        category,
        'deleted.status': false
    })
        .sort({createdAt: -1})
        .limit(limit);
};

NotificationSchema.statics.getPriorityNotifications = function (userId) {
    return this.find({
        userId,
        priority: {$in: ['HIGH', 'URGENT', 'CRITICAL']},
        'read.status': false,
        'deleted.status': false,
        status: {$in: ['SENT', 'DELIVERED']}
    })
        .sort({priority: -1, createdAt: -1});
};

export default mongoose.models.Notification || mongoose.model("Notification", NotificationSchema);
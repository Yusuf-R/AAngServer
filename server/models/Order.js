// /models/Orders/OrderManagement.js
import mongoose from "mongoose";
import dbClient from "../database/mongoDB";

const { Schema, model } = mongoose;

const connectDB = async () => {
    if (mongoose.connection.readyState !== 1) {
        await dbClient.connect();
    }
};

// Enhanced Location Schema for precise tracking
const LocationSchema = new Schema({
    address: {
        type: String,
        required: function() {
            return this.parent().status !== 'draft';
        }
    },
    coordinates: {
        type: {
            type: String,
            enum: ['Point'],
            default: 'Point',
            required: true
        },
        coordinates: {
            type: [Number], // [longitude, latitude]
            required: true,
            validate: {
                validator: function(v) {
                    return v.length === 2 &&
                        v[0] >= -180 && v[0] <= 180 &&
                        v[1] >= -90 && v[1] <= 90;
                },
                message: props => `${props.value} is not a valid coordinate pair`
            }
        }
    },
    landmark: String,
    contactPerson: {
        name: String,
        phone: String,
        alternatePhone: String
    },
    instructions: String,
    locationType: {
        type: String,
        enum: ['residential', 'commercial', 'office', 'mall', 'hospital', 'school', 'other'],
        default: 'residential'
    },
    // For apartment/office buildings
    building: {
        name: String,
        floor: String,
        unit: String
    }
}, { _id: false });

// Package Details Schema
const PackageSchema = new Schema({
    category: {
        type: String,
        enum: ['document', 'parcel', 'food', 'fragile', 'electronics', 'clothing', 'medicine', 'furniture', 'jewelry', 'gifts', 'books', 'others'],
        required: function() {
            return this.parent().status !== 'draft';
        }
    },
    dimensions: {
        length: Number,
        width: Number,
        height: Number,
        unit: { type: String, enum: ['cm', 'inch'], default: 'cm' }
    },
    weight: {
        value: Number,
        unit: { type: String, enum: ['kg', 'g'], default: 'kg' }
    },
    value: Number, // Declared value for insurance
    isFragile: { type: Boolean, default: false },
    requiresSpecialHandling: { type: Boolean, default: false },
    images: [String], // Package photos
    description: String,
    specialInstructions: String
}, { _id: false });

// Cost Calculation Schema
const PricingSchema = new Schema({
    baseFare: { type: Number, required: true },
    distanceFare: Number,
    timeFare: Number,
    weightFare: Number,
    priorityFare: Number,
    surcharges: [{
        type: { type: String },
        amount: Number,
        reason: String
    }],
    discount: {
        amount: Number,
        code: String,
        reason: String
    },
    totalAmount: { type: Number, required: true },
    currency: { type: String, default: 'NGN' }
}, { _id: false });

// Timeline/Status History Schema
const StatusHistorySchema = new Schema({
    status: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    location: {
        lat: Number,
        lng: Number,
        address: String
    },
    updatedBy: {
        userId: { type: Schema.Types.ObjectId, ref: 'Base' },
        role: { type: String, enum: ['client', 'driver', 'admin', 'system'] }
    },
    notes: String,
    photos: [String], // Proof of delivery photos, etc.
    signature: String // Digital signature for delivery confirmation
}, { _id: true });

// Real-time Tracking Schema
const TrackingSchema = new Schema({
    driverId: { type: Schema.Types.ObjectId, ref: 'Base', index: true },
    driverInfo: {
        name: String,
        phone: String,
        vehicleType: String,
        vehicleNumber: String,
        rating: Number
    },
    currentLocation: {
        lat: Number,
        lng: Number,
        accuracy: Number,
        timestamp: { type: Date, default: Date.now }
    },
    route: [{
        lat: Number,
        lng: Number,
        timestamp: Date,
        speed: Number
    }],
    estimatedArrival: {
        pickup: Date,
        dropoff: Date
    },
    actualTimes: {
        assignedAt: Date,
        pickedUpAt: Date,
        inTransitAt: Date,
        deliveredAt: Date
    },
    distance: {
        total: Number,
        remaining: Number,
        unit: { type: String, default: 'km' }
    },
    duration: {
        estimated: Number, // in minutes
        actual: Number
    }
}, { _id: false });

// Main Order Schema
const OrderSchema = new Schema({
    // Basic Order Information
    orderRef: {
        type: String,
        unique: true,
        required: true,
        index: true
    },
    clientId: {
        type: Schema.Types.ObjectId,
        ref: 'Base',
        required: true,
        index: true
    },

    // Order Type and Priority
    orderType: {
        type: String,
        enum: ['instant', 'scheduled', 'recurring'],
        default: 'instant'
    },
    priority: {
        type: String,
        enum: ['low', 'normal', 'high', 'urgent'],
        default: 'normal'
    },

    // Delivery Details
    pickup: { type: LocationSchema, required: true },
    dropoff: { type: LocationSchema, required: true },
    package: { type: PackageSchema, required: true },

    // Scheduling
    scheduledPickup: Date,
    deliveryWindow: {
        start: Date,
        end: Date
    },

    // Vehicle Requirements
    vehicleRequirements: {
        type: [String],
        enum: ['bicycle', 'motorcycle', 'tricycle', 'van', 'truck'],
        default: ['bicycle', 'motorcycle']
    },

    // Order Status
    status: {
        type: String,
        enum: [
            'draft',           // Order being created
            'pending',         // Waiting for driver assignment
            'broadcast',       // Broadcasted to available drivers
            'assigned',        // Driver assigned
            'confirmed',       // Driver confirmed pickup
            'en_route_pickup', // Driver heading to pickup
            'arrived_pickup',  // Driver at pickup location
            'picked_up',       // Package collected
            'in_transit',      // On the way to delivery
            'arrived_dropoff', // Driver at delivery location
            'delivered',       // Successfully delivered
            'failed',          // Delivery failed
            'cancelled',       // Order cancelled
            'returned'         // Returned to sender
        ],
        default: 'draft',
        index: true
    },

    // Pricing
    pricing: PricingSchema,

    // Payment
    payment: {
        method: {
            type: String,
            enum: ['wallet', 'card', 'bank_transfer', 'cash_on_delivery', 'cash_on_pickup'],
            required: true
        },
        status: {
            type: String,
            enum: ['pending', 'processing', 'paid', 'failed', 'refunded'],
            default: 'pending'
        },
        transactionId: String,
        paidAt: Date,
        refundedAt: Date,
        refundReason: String
    },

    deliveryToken: {
        type: String,
        required: true,
        select: false // Prevent accidental exposure
    },
    tokenVerified: {
        verified: { type: Boolean, default: false },
        verifiedAt: Date,
        verifiedBy: {
            name: String,
            phone: String
        }
    },

    pickupConfirmation: {
        confirmedBy: {
            name: String,
            phone: String
        },
        confirmedAt: Date,
        photos: [String],
        signature: String
    },

    deliveryConfirmation: {
        photos: [String],
        videos: [String],
        signature: String,
        verifiedBy: {
            name: String,
            phone: String
        },
        verifiedAt: Date
    },

    // Tracking and Assignment
    tracking: TrackingSchema,

    // Driver Assignment History
    assignmentHistory: [{
        driverId: { type: Schema.Types.ObjectId, ref: 'Base' },
        assignedAt: { type: Date, default: Date.now },
        status: {
            type: String,
            enum: ['assigned', 'accepted', 'rejected', 'cancelled', 'completed']
        },
        rejectionReason: String,
        responseTime: Number // in seconds
    }],

    // Status History
    statusHistory: [StatusHistorySchema],

    // Rating and Feedback
    rating: {
        clientRating: {
            stars: { type: Number, min: 1, max: 5 },
            feedback: String,
            ratedAt: Date
        },
        driverRating: {
            stars: { type: Number, min: 1, max: 5 },
            feedback: String,
            ratedAt: Date
        }
    },

    // Communication
    communications: [{
        type: { type: String, enum: ['sms', 'call', 'push', 'email'] },
        recipient: String,
        content: String,
        sentAt: { type: Date, default: Date.now },
        status: { type: String, enum: ['sent', 'delivered', 'failed'] }
    }],

    // Insurance and Liability
    insurance: {
        isInsured: { type: Boolean, default: false },
        coverage: Number,
        provider: String,
        policyNumber: String
    },

    // Special Flags
    flags: {
        isUrgent: { type: Boolean, default: false },
        requiresProofOfDelivery: { type: Boolean, default: true },
        allowDriverSubstitution: { type: Boolean, default: true },
        isRecurring: { type: Boolean, default: false },
        isHighValue: { type: Boolean, default: false }
    },

    // Metadata
    metadata: {
        createdBy: { type: String, enum: ['client', 'admin', 'system'], default: 'client' },
        channel: { type: String, enum: ['mobile', 'web', 'api'], default: 'mobile' },
        sourceIP: String,
        userAgent: String,
        referenceNumber: String, // External system reference
        notes: String,

        // Add draft progress tracking
        draftProgress: {
            step: { type: Number, default: 1 }, // Current step (1-7)
            completedSteps: [{ type: Number }], // Array of completed step numbers
            lastUpdated: { type: Date, default: Date.now },
            completedAt: Date, // When all steps were completed

            // Track form field completion for better UX
            fieldCompletion: {
                pickup: { type: Boolean, default: false },
                dropoff: { type: Boolean, default: false },
                package: { type: Boolean, default: false },
                scheduling: { type: Boolean, default: false },
                vehicle: { type: Boolean, default: false },
                payment: { type: Boolean, default: false },
                confirmation: { type: Boolean, default: false }
            }
        }
    },

    // Cancellation
    cancellation: {
        reason: String,
        cancelledBy: { type: Schema.Types.ObjectId, ref: 'Base' },
        cancelledAt: Date,
        refundAmount: Number,
        cancellationFee: Number
    }

}, {
    timestamps: true,
    collection: 'orders'
});

// Indexes for Performance
OrderSchema.index({ clientId: 1, status: 1 });
OrderSchema.index({ 'tracking.driverId': 1, status: 1 });
OrderSchema.index({ status: 1, createdAt: -1 });
OrderSchema.index({ orderType: 1, scheduledPickup: 1 });
OrderSchema.index({ 'pickup.coordinates': '2dsphere' });
OrderSchema.index({ 'dropoff.coordinates': '2dsphere' });
OrderSchema.index({ createdAt: -1 });

// Virtual for order age
OrderSchema.virtual('orderAge').get(function() {
    return Date.now() - this.createdAt.getTime();
});

// Virtual for estimated delivery time
OrderSchema.virtual('estimatedDeliveryTime').get(function() {
    if (this.tracking && this.tracking.estimatedArrival) {
        return this.tracking.estimatedArrival.dropoff;
    }
    return null;
});

// Pre-save middleware
OrderSchema.pre('save', function(next) {
    // Generate order reference if not exists
    if (!this.orderRef) {
        this.orderRef = generateOrderRef();
    }

    // Update status history
    if (this.isModified('status')) {
        this.statusHistory.push({
            status: this.status,
            timestamp: new Date(),
            updatedBy: {
                userId: this.metadata?.updatedBy || null,
                role: this.metadata?.updatedByRole || 'system'
            }
        });
    }

    next();
});

// Static methods
OrderSchema.statics.findActiveOrders = function() {
    return this.find({
        status: { $in: ['pending', 'assigned', 'confirmed', 'picked_up', 'in_transit'] }
    });
};

OrderSchema.statics.findOrdersForDriver = function(driverId) {
    return this.find({
        'tracking.driverId': driverId,
        status: { $in: ['assigned', 'confirmed', 'picked_up', 'in_transit'] }
    });
};

OrderSchema.statics.findNearbyOrders = function(lat, lng, maxDistance = 10000) {
    return this.find({
        'pickup.coordinates': {
            $near: {
                $geometry: { type: 'Point', coordinates: [lng, lat] },
                $maxDistance: maxDistance
            }
        },
        status: 'pending'
    });
};

OrderSchema.statics.getOrderStats = async function(clientId) {
    const matchStage = clientId ? { clientId: new mongoose.Types.ObjectId(clientId) } : {};

    const pipeline = [
        { $match: matchStage },
        {
            $group: {
                _id: {
                    $cond: [
                        { $in: ["$status", ["delivered"]] },
                        "completed",
                        {
                            $cond: [
                                { $in: ["$status", ["pending", "assigned", "confirmed", "picked_up", "in_transit"]] },
                                "active",
                                "other"
                            ]
                        }
                    ]
                },
                count: { $sum: 1 }
            }
        }
    ];

    const results = await this.aggregate(pipeline);

    const stats = { total: 0, active: 0, completed: 0 };

    results.forEach(entry => {
        if (entry._id === "active") stats.active = entry.count;
        if (entry._id === "completed") stats.completed = entry.count;
        stats.total += entry.count;
    });

    return stats;
};

OrderSchema.statics.getOrderHistory = async function(clientId, limit = 10) {
    const orders = await this.find({ clientId })
        .sort({ createdAt: -1 })
        .limit(limit)
        .select([
            '_id',
            'status',
            'createdAt',
            'dropoff.address',
            'dropoff.landmark',
            'package.description',
            'package.category'
        ])
        .lean();

    return orders.map(order => ({
        id: order._id.toString(),
        title: order.package.description || `Delivery (${order.package.category})`,
        status: order.status,
        date: timeAgo(order.createdAt),
        destination: order.dropoff.landmark || order.dropoff.address || 'Unknown location'
    }));
};


// Order Assignment Schema - Separate collection for managing driver assignments
const OrderAssignmentSchema = new Schema({
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    availableDrivers: [{
        driverId: { type: Schema.Types.ObjectId, ref: 'Base', required: true },
        distance: Number,
        estimatedArrival: Number,
        notifiedAt: { type: Date, default: Date.now },
        responded: { type: Boolean, default: false },
        response: { type: String, enum: ['accepted', 'rejected'] },
        responseTime: Number,
        rejectionReason: String
    }],
    assignmentStrategy: {
        type: String,
        enum: ['nearest', 'fastest', 'rating_based', 'round_robin'],
        default: 'nearest'
    },
    broadcastRadius: { type: Number, default: 5000 }, // in meters
    maxDrivers: { type: Number, default: 10 },
    timeoutDuration: { type: Number, default: 300 }, // 5 minutes in seconds
    status: {
        type: String,
        enum: ['broadcasting', 'assigned', 'failed', 'cancelled'],
        default: 'broadcasting'
    },
    assignedDriverId: { type: Schema.Types.ObjectId, ref: 'Base' },
    assignedAt: Date,
    failureReason: String
}, {
    timestamps: true,
    collection: 'order_assignments'
});

OrderAssignmentSchema.index({ orderId: 1 });
OrderAssignmentSchema.index({ 'availableDrivers.driverId': 1 });
OrderAssignmentSchema.index({ status: 1, createdAt: 1 });

// Utility function to generate order reference
function generateOrderRef() {
    const prefix = 'ORD';
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substr(2, 4).toUpperCase();
    return `${prefix}-${timestamp}-${random}`;
}

function timeAgo(date) {
    const now = new Date();
    const diff = now - new Date(date);
    const seconds = Math.floor(diff / 1000);

    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days === 1) return `Yesterday`;
    return `${days}d ago`;
}

// Export function to get models
const getOrderModels = async () => {
    await connectDB();

    const Order = mongoose.models.Order || model('Order', OrderSchema);
    const OrderAssignment = mongoose.models.OrderAssignment || model('OrderAssignment', OrderAssignmentSchema);

    return { Order, OrderAssignment };
};

export default getOrderModels;
export { generateOrderRef };
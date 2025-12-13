// /models/Analytics/ClientAnalytics.js
import mongoose from "mongoose";
import dbClient from "../../database/mongoDB";

const { Schema, model } = mongoose;

const connectDB = async () => {
    if (mongoose.connection.readyState !== 1) {
        await dbClient.connect();
    }
};

const ClientAnalyticsSchema = new Schema({
    clientId: {
        type: Schema.Types.ObjectId,
        ref: 'Base',
        required: true,
        unique: true,
        index: true
    },

    // Lifetime Statistics
    lifetime: {
        totalOrders: { type: Number, default: 0 },
        completedOrders: { type: Number, default: 0 },
        cancelledOrders: { type: Number, default: 0 },
        totalSpent: { type: Number, default: 0 },
        totalDistance: { type: Number, default: 0 },
        averageOrderValue: { type: Number, default: 0 },
        averageRating: { type: Number, default: 0 }, // Rating given to drivers
        totalRatingsGiven: { type: Number, default: 0 },
        firstOrderAt: Date,
        lastOrderAt: Date
    },

    // Daily Statistics (Last 30 days)
    daily: [{
        period: { type: Date, required: true },
        orders: {
            total: { type: Number, default: 0 },
            completed: { type: Number, default: 0 },
            cancelled: { type: Number, default: 0 }
        },
        spending: {
            gross: { type: Number, default: 0 },
            fees: { type: Number, default: 0 },
            net: { type: Number, default: 0 }
        },
        distance: { type: Number, default: 0 },
        categories: [String] // Package categories ordered
    }],

    // Weekly Statistics (Last 12 weeks)
    weekly: [{
        weekStart: { type: Date, required: true },
        weekEnd: { type: Date, required: true },
        weekNumber: Number,
        orders: {
            total: { type: Number, default: 0 },
            completed: { type: Number, default: 0 },
            cancelled: { type: Number, default: 0 }
        },
        spending: {
            gross: { type: Number, default: 0 },
            fees: { type: Number, default: 0 },
            net: { type: Number, default: 0 }
        },
        distance: { type: Number, default: 0 }
    }],

    // Monthly Statistics (Last 12 months)
    monthly: [{
        period: { type: Date, required: true },
        month: Number,
        year: Number,
        orders: {
            total: { type: Number, default: 0 },
            completed: { type: Number, default: 0 },
            cancelled: { type: Number, default: 0 }
        },
        spending: {
            gross: { type: Number, default: 0 },
            fees: { type: Number, default: 0 },
            net: { type: Number, default: 0 }
        },
        distance: { type: Number, default: 0 }
    }],

    // Order Category Breakdown
    categories: {
        laptop: { count: { type: Number, default: 0 }, spent: { type: Number, default: 0 } },
        document: { count: { type: Number, default: 0 }, spent: { type: Number, default: 0 } },
        food: { count: { type: Number, default: 0 }, spent: { type: Number, default: 0 } },
        electronics: { count: { type: Number, default: 0 }, spent: { type: Number, default: 0 } },
        mobilePhone: { count: { type: Number, default: 0 }, spent: { type: Number, default: 0 } },
        clothing: { count: { type: Number, default: 0 }, spent: { type: Number, default: 0 } },
        furniture: { count: { type: Number, default: 0 }, spent: { type: Number, default: 0 } },
        medicine: { count: { type: Number, default: 0 }, spent: { type: Number, default: 0 } },
        gifts: { count: { type: Number, default: 0 }, spent: { type: Number, default: 0 } },
        cake: { count: { type: Number, default: 0 }, spent: { type: Number, default: 0 } },
        books: { count: { type: Number, default: 0 }, spent: { type: Number, default: 0 } },
        others: { count: { type: Number, default: 0 }, spent: { type: Number, default: 0 } }
    },

    // Geographic Statistics
    geographic: {
        topPickupAreas: [{
            state: String,
            lga: String,
            orderCount: Number,
            totalSpent: Number
        }],
        topDropoffAreas: [{
            state: String,
            lga: String,
            orderCount: Number,
            totalSpent: Number
        }],
        averageDistance: Number
    },

    // Payment Statistics
    payments: {
        totalPaid: { type: Number, default: 0 },
        totalFees: { type: Number, default: 0 },
        wallet: {
            totalDeposited: { type: Number, default: 0 },
            totalUsed: { type: Number, default: 0 },
            currentBalance: { type: Number, default: 0 }
        },
        paymentMethods: {
            paystack: { count: { type: Number, default: 0 }, amount: { type: Number, default: 0 } },
            wallet: { count: { type: Number, default: 0 }, amount: { type: Number, default: 0 } },
            combined: { count: { type: Number, default: 0 }, amount: { type: Number, default: 0 } }
        }
    },

    // Ratings Given to Drivers
    ratingsGiven: {
        overall: {
            average: { type: Number, default: 0 },
            total: { type: Number, default: 0 },
            distribution: {
                fiveStar: { type: Number, default: 0 },
                fourStar: { type: Number, default: 0 },
                threeStar: { type: Number, default: 0 },
                twoStar: { type: Number, default: 0 },
                oneStar: { type: Number, default: 0 }
            }
        },
        categories: {
            professionalism: { average: { type: Number, default: 0 }, total: { type: Number, default: 0 } },
            timeliness: { average: { type: Number, default: 0 }, total: { type: Number, default: 0 } },
            communication: { average: { type: Number, default: 0 }, total: { type: Number, default: 0 } },
            care: { average: { type: Number, default: 0 }, total: { type: Number, default: 0 } }
        }
    },

    // Order Patterns
    patterns: {
        mostActiveDay: String, // Monday, Tuesday, etc.
        mostActiveHour: Number, // 0-23
        averageOrdersPerWeek: Number,
        peakOrderingTime: {
            dayOfWeek: String,
            hourOfDay: Number
        }
    },

    // Trends
    trends: {
        spending: {
            trend: { type: String, enum: ['increasing', 'decreasing', 'stable'] },
            changePercent: Number,
            periodCompared: String
        },
        orderFrequency: {
            trend: { type: String, enum: ['increasing', 'decreasing', 'stable'] },
            changePercent: Number,
            periodCompared: String
        }
    },

    // Achievements/Milestones
    achievements: {
        milestones: [{
            type: { type: String },
            achievedAt: Date,
            badge: String,
            description: String
        }]
    }

}, {
    timestamps: true,
    collection: 'client_analytics'
});

// Indexes
ClientAnalyticsSchema.index({ 'lifetime.lastOrderAt': -1 });
ClientAnalyticsSchema.index({ updatedAt: -1 });

// Export Models
const getClientAnalyticsModels = async () => {
    await connectDB();

    const ClientAnalytics = mongoose.models.ClientAnalytics ||
        model('ClientAnalytics', ClientAnalyticsSchema);

    return { ClientAnalytics };
};

export default getClientAnalyticsModels;
export { ClientAnalyticsSchema };
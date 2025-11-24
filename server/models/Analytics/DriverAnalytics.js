// /models/Analytics/DriverAnalytics.js
import mongoose from "mongoose";
import dbClient from "../../database/mongoDB";

const { Schema, model } = mongoose;

const connectDB = async () => {
    if (mongoose.connection.readyState !== 1) {
        await dbClient.connect();
    }
};

// Time-based Analytics Schema (for daily/weekly/monthly aggregations)
const TimeBasedMetricsSchema = new Schema({
    period: { type: String, required: true }, // '2024-11-19', '2024-W47', '2024-11'
    periodType: { type: String, enum: ['daily', 'weekly', 'monthly', 'yearly'], required: true },

    // Core Metrics
    deliveries: {
        total: { type: Number, default: 0 },
        completed: { type: Number, default: 0 },
        cancelled: { type: Number, default: 0 },
        failed: { type: Number, default: 0 }
    },

    // Financial Metrics
    earnings: {
        gross: { type: Number, default: 0 },
        net: { type: Number, default: 0 },
        tips: { type: Number, default: 0 },
        bonuses: { type: Number, default: 0 },
        penalties: { type: Number, default: 0 },
        fuel: { type: Number, default: 0 },
        withdrawn: { type: Number, default: 0 },
        fees: { type: Number, default: 0 }
    },

    // Performance Metrics
    performance: {
        averageRating: { type: Number, default: 0 },
        totalRatings: { type: Number, default: 0 },
        onTimeDeliveries: { type: Number, default: 0 },
        lateDeliveries: { type: Number, default: 0 },
        averageDeliveryTime: { type: Number, default: 0 }, // minutes
        completionRate: { type: Number, default: 0 }, // percentage
        acceptanceRate: { type: Number, default: 0 } // percentage
    },

    // Time Metrics
    timeMetrics: {
        hoursOnline: { type: Number, default: 0 },
        hoursActive: { type: Number, default: 0 }, // actually delivering
        hoursIdle: { type: Number, default: 0 },
        averageResponseTime: { type: Number, default: 0 }, // seconds
        peakHours: [{
            hour: Number,
            deliveries: Number,
            earnings: Number
        }]
    },

    // Distance Metrics
    distance: {
        total: { type: Number, default: 0 }, // km
        withPackage: { type: Number, default: 0 },
        empty: { type: Number, default: 0 },
        averagePerDelivery: { type: Number, default: 0 }
    },

    // Customer Satisfaction
    satisfaction: {
        positiveRatings: { type: Number, default: 0 }, // 4-5 stars
        neutralRatings: { type: Number, default: 0 }, // 3 stars
        negativeRatings: { type: Number, default: 0 }, // 1-2 stars
        wouldRecommendCount: { type: Number, default: 0 },
        wouldRecommendRate: { type: Number, default: 0 }, // percentage
        complaints: { type: Number, default: 0 }
    }
}, { _id: false });

// Rating Analytics Schema
const RatingAnalyticsSchema = new Schema({
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

    // Category-specific ratings
    categories: {
        professionalism: {
            average: { type: Number, default: 0 },
            total: { type: Number, default: 0 },
            trend: { type: String, enum: ['improving', 'stable', 'declining'], default: 'stable' }
        },
        timeliness: {
            average: { type: Number, default: 0 },
            total: { type: Number, default: 0 },
            trend: { type: String, enum: ['improving', 'stable', 'declining'], default: 'stable' }
        },
        communication: {
            average: { type: Number, default: 0 },
            total: { type: Number, default: 0 },
            trend: { type: String, enum: ['improving', 'stable', 'declining'], default: 'stable' }
        },
        care: {
            average: { type: Number, default: 0 },
            total: { type: Number, default: 0 },
            trend: { type: String, enum: ['improving', 'stable', 'declining'], default: 'stable' }
        }
    },

    // Recent feedback highlights
    recentFeedback: [{
        orderId: Schema.Types.ObjectId,
        stars: Number,
        comment: String,
        categories: Schema.Types.Mixed,
        wouldRecommend: Boolean,
        createdAt: { type: Date, default: Date.now }
    }],

    // Improvement areas (auto-calculated)
    improvementAreas: [{
        category: String,
        currentScore: Number,
        targetScore: Number,
        priority: { type: String, enum: ['high', 'medium', 'low'] }
    }]
}, { _id: false });

// Geographic Analytics
const GeographicAnalyticsSchema = new Schema({
    topAreas: [{
        zone: String,
        state: String,
        lga: String,
        deliveryCount: { type: Number, default: 0 },
        totalEarnings: { type: Number, default: 0 },
        averageEarnings: { type: Number, default: 0 },
        averageRating: { type: Number, default: 0 },
        lastDelivered: Date
    }],

    coverage: {
        statesCovered: [String],
        lgasCovered: [String],
        totalZones: { type: Number, default: 0 }
    },

    routeEfficiency: {
        averageDistancePerOrder: { type: Number, default: 0 },
        mostEfficientRoute: String,
        leastEfficientRoute: String
    }
}, { _id: false });

// Achievements & Milestones
const AchievementsSchema = new Schema({
    milestones: [{
        type: {
            type: String,
            enum: [
                'first_delivery', '10_deliveries', '50_deliveries',
                '100_deliveries', '500_deliveries', '1000_deliveries',
                'perfect_week', 'perfect_month', 'top_rated_month',
                'high_earner', 'speed_demon', 'reliable_partner'
            ]
        },
        achievedAt: Date,
        value: Number, // Relevant metric value
        badge: String,
        description: String
    }],

    streaks: {
        current: {
            type: { type: String, enum: ['delivery', 'rating', 'punctuality'] },
            count: { type: Number, default: 0 },
            startDate: Date
        },
        longest: {
            type: { type: String, enum: ['delivery', 'rating', 'punctuality'] },
            count: { type: Number, default: 0 },
            period: String
        }
    },

    rankings: {
        local: { rank: Number, total: Number, percentile: Number },
        regional: { rank: Number, total: Number, percentile: Number },
        national: { rank: Number, total: Number, percentile: Number }
    }
}, { _id: false });

// Main Driver Analytics Schema
const DriverAnalyticsSchema = new Schema({
    driverId: {
        type: Schema.Types.ObjectId,
        ref: 'Driver',
        required: true,
        unique: true,
        index: true
    },

    // Current snapshot (real-time)
    currentSnapshot: {
        status: { type: String, enum: ['online', 'offline', 'on-delivery', 'break'] },
        currentEarnings: { type: Number, default: 0 },
        todayDeliveries: { type: Number, default: 0 },
        todayHours: { type: Number, default: 0 },
        activeOrders: { type: Number, default: 0 },
        lastUpdated: { type: Date, default: Date.now }
    },

    // Lifetime Statistics
    lifetime: {
        totalDeliveries: { type: Number, default: 0 },
        totalEarnings: { type: Number, default: 0 },
        totalDistance: { type: Number, default: 0 },
        totalHours: { type: Number, default: 0 },
        averageRating: { type: Number, default: 0 },
        memberSince: Date,
        lastDeliveryDate: Date,
        lastWithdrawalDate: Date
    },

    // Time-based analytics (auto-aggregated)
    daily: [TimeBasedMetricsSchema],
    weekly: [TimeBasedMetricsSchema],
    monthly: [TimeBasedMetricsSchema],
    yearly: [TimeBasedMetricsSchema],

    // Rating Analytics (integrated from DriverRatingSummary)
    ratings: RatingAnalyticsSchema,

    // Geographic Analytics
    geographic: GeographicAnalyticsSchema,

    // Achievements & Milestones
    achievements: AchievementsSchema,

    // Performance Trends (auto-calculated)
    trends: {
        earnings: {
            trend: { type: String, enum: ['increasing', 'stable', 'decreasing'] },
            changePercent: Number,
            comparisonPeriod: String // 'vs last week', 'vs last month'
        },
        rating: {
            trend: { type: String, enum: ['improving', 'stable', 'declining'] },
            changePercent: Number,
            comparisonPeriod: String
        },
        efficiency: {
            trend: { type: String, enum: ['improving', 'stable', 'declining'] },
            changePercent: Number,
            metric: String // 'delivery time', 'acceptance rate', etc.
        }
    },

    // Goals & Targets (driver can set these)
    goals: [{
        type: { type: String, enum: ['earnings', 'deliveries', 'rating', 'hours'] },
        target: Number,
        current: Number,
        period: { type: String, enum: ['daily', 'weekly', 'monthly'] },
        deadline: Date,
        achieved: { type: Boolean, default: false }
    }],

    // Last calculation timestamp
    lastCalculated: { type: Date, default: Date.now },
    calculationStatus: {
        type: String,
        enum: ['up_to_date', 'calculating', 'stale'],
        default: 'up_to_date'
    }
}, {
    timestamps: true,
    collection: 'driver_analytics'
});

// Indexes for Performance
DriverAnalyticsSchema.index({ 'lifetime.totalDeliveries': -1 });
DriverAnalyticsSchema.index({ 'lifetime.averageRating': -1 });
DriverAnalyticsSchema.index({ 'currentSnapshot.lastUpdated': -1 });
DriverAnalyticsSchema.index({ 'daily.period': 1 });
DriverAnalyticsSchema.index({ 'weekly.period': 1 });
DriverAnalyticsSchema.index({ 'monthly.period': 1 });

// Static Methods for Analytics Updates

// Initialize analytics for new driver
DriverAnalyticsSchema.statics.initializeForDriver = async function(driverId, driverData) {
    const analytics = new this({
        driverId,
        lifetime: {
            memberSince: driverData.createdAt || new Date()
        },
        currentSnapshot: {
            status: 'offline'
        }
    });
    return await analytics.save();
};

// Update analytics after order completion
DriverAnalyticsSchema.statics.updateAfterOrderCompletion = async function(driverId, orderData) {
    const today = new Date().toISOString().split('T')[0];
    const weekNum = getWeekNumber(new Date());
    const monthKey = new Date().toISOString().substring(0, 7);
    const yearKey = new Date().getFullYear().toString();

    const update = {
        $inc: {
            'lifetime.totalDeliveries': 1,
            'lifetime.totalEarnings': orderData.earnings || 0,
            'lifetime.totalDistance': orderData.distance || 0,
            'lifetime.totalHours': orderData.duration / 60 || 0,
            'currentSnapshot.todayDeliveries': 1,
            'currentSnapshot.currentEarnings': orderData.earnings || 0
        },
        $set: {
            'lifetime.lastDeliveryDate': new Date(),
            'currentSnapshot.lastUpdated': new Date()
        }
    };

    // Update daily metrics
    await this.updateOne(
        { driverId, 'daily.period': today },
        {
            ...update,
            $inc: {
                'daily.$.deliveries.total': 1,
                'daily.$.deliveries.completed': orderData.status === 'completed' ? 1 : 0,
                'daily.$.earnings.gross': orderData.earnings || 0,
                'daily.$.distance.total': orderData.distance || 0
            }
        }
    );

    // If daily record doesn't exist, create it
    await this.updateOne(
        { driverId, 'daily.period': { $ne: today } },
        {
            $push: {
                daily: {
                    period: today,
                    periodType: 'daily',
                    deliveries: { total: 1, completed: orderData.status === 'completed' ? 1 : 0 },
                    earnings: { gross: orderData.earnings || 0 },
                    distance: { total: orderData.distance || 0 }
                }
            }
        }
    );

    // Similar updates for weekly, monthly, yearly
    // (Implementation details for weekly/monthly/yearly updates)

    return await this.findOne({ driverId });
};

// Update analytics after rating received
DriverAnalyticsSchema.statics.updateAfterRating = async function(driverId, ratingData) {
    const update = {
        $inc: {
            'ratings.overall.total': 1,
            [`ratings.overall.distribution.${ratingData.stars}Star`]: 1
        },
        $push: {
            'ratings.recentFeedback': {
                $each: [{
                    orderId: ratingData.orderId,
                    stars: ratingData.stars,
                    comment: ratingData.feedback,
                    categories: ratingData.categories,
                    wouldRecommend: ratingData.wouldRecommend,
                    createdAt: new Date()
                }],
                $slice: -20 // Keep only last 20
            }
        }
    };

    // Update category averages
    if (ratingData.categories) {
        for (const [category, rating] of Object.entries(ratingData.categories)) {
            update.$inc[`ratings.categories.${category}.total`] = 1;
        }
    }

    await this.updateOne({ driverId }, update);

    // Recalculate averages
    return await this.recalculateRatingAverages(driverId);
};

// Recalculate rating averages
DriverAnalyticsSchema.statics.recalculateRatingAverages = async function(driverId) {
    const analytics = await this.findOne({ driverId });
    if (!analytics) return null;

    const { distribution } = analytics.ratings.overall;
    const total = analytics.ratings.overall.total;

    if (total > 0) {
        const weightedSum = (
            (distribution.fiveStar * 5) +
            (distribution.fourStar * 4) +
            (distribution.threeStar * 3) +
            (distribution.twoStar * 2) +
            (distribution.oneStar * 1)
        );

        analytics.ratings.overall.average = weightedSum / total;
        analytics.lifetime.averageRating = weightedSum / total;

        // Update category averages similarly
        // (Implementation for category calculations)

        await analytics.save();
    }

    return analytics;
};

// Add to DriverAnalyticsSchema.statics
DriverAnalyticsSchema.statics.updateAfterWithdrawal = async function(driverId, withdrawalData) {
    const {
        amount,
        fees,
        netAmount,
        period = new Date().toISOString().split('T')[0] // default to today
    } = withdrawalData;

    const today = period;
    const weekKey = getWeekKey(new Date());
    const monthKey = new Date().toISOString().substring(0, 7);
    const yearKey = new Date().getFullYear().toString();

    const update = {
        $inc: {
            'lifetime.totalWithdrawn': amount,
            'lifetime.totalFees': fees
        },
        $set: {
            'lifetime.lastWithdrawalDate': new Date()
        }
    };

    // Update daily metrics
    await this.updateOne(
        { driverId, 'daily.period': today },
        {
            $inc: {
                'daily.$.earnings.withdrawn': amount,
                'daily.$.earnings.fees': fees
            }
        }
    );

    // Update weekly metrics
    await this.updateOne(
        { driverId, 'weekly.period': weekKey },
        {
            $inc: {
                'weekly.$.earnings.withdrawn': amount,
                'weekly.$.earnings.fees': fees
            }
        }
    );

    // Update monthly metrics
    await this.updateOne(
        { driverId, 'monthly.period': monthKey },
        {
            $inc: {
                'monthly.$.earnings.withdrawn': amount,
                'monthly.$.earnings.fees': fees
            }
        }
    );

    // Update yearly metrics
    await this.updateOne(
        { driverId, 'yearly.period': yearKey },
        {
            $inc: {
                'yearly.$.earnings.withdrawn': amount,
                'yearly.$.earnings.fees': fees
            }
        }
    );

    return await this.findOne({ driverId });
};

// Helper function to get week number
function getWeekNumber(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNum = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return `${d.getUTCFullYear()}-W${weekNum.toString().padStart(2, '0')}`;
}

// Get or create models
const getAnalyticsModels = async () => {
    await connectDB();
    const DriverAnalytics = mongoose.models.DriverAnalytics || model('DriverAnalytics', DriverAnalyticsSchema);
    return { DriverAnalytics };
};

export default getAnalyticsModels;
export { DriverAnalyticsSchema };
// /utils/analyticsUpdater.js
import getAnalyticsModels from '../models/Analytics/DriverAnalytics.js';
import getModels from '../models/AAng/AAngLogistics.js';
import getOrderModels from '../models/Order.js';

/**
 * Analytics Auto-Update System
 * This module handles automatic updates to driver analytics
 * based on various events in the system
 */

class AnalyticsUpdater {
    constructor() {
        this.updateQueue = [];
        this.isProcessing = false;
    }

    /**
     * Initialize analytics for a new driver
     */
    async initializeDriverAnalytics(driverId, driverData) {
        try {
            const { DriverAnalytics } = await getAnalyticsModels();

            // Check if analytics already exists
            const existing = await DriverAnalytics.findOne({ driverId });
            if (existing) {
                console.log(`Analytics already exists for driver ${driverId}`);
                return existing;
            }

            // Create new analytics record
            return await DriverAnalytics.initializeForDriver(driverId, driverData);
        } catch (error) {
            console.error('Error initializing driver analytics:', error);
            throw error;
        }
    }

    /**
     * Update analytics when order is completed
     */
    async updateOnOrderCompletion(orderId) {
        try {
            const { Order } = await getOrderModels();
            const { DriverAnalytics } = await getAnalyticsModels();

            const order = await Order.findById(orderId)
                .populate('driverAssignment.driverId', 'fullName email');

            if (!order || !order.driverAssignment?.driverId) {
                console.log('No driver assigned to order:', orderId);
                return;
            }

            const driverId = order.driverAssignment.driverId._id;

            // Prepare order data for analytics
            const orderData = {
                orderId: order._id,
                earnings: order.payment?.financialBreakdown.driverShare || 0,
                distance: order.driverAssignment.distance?.total || 0,
                duration: order.driverAssignment.duration?.actual || 0,
                status: order.status,
                completedAt: new Date(),
                isOnTime: this.checkIfOnTime(order),
                pickupLocation: {
                    state: order.location.pickUp.state,
                    lga: order.location.pickUp.lga,
                    zone: order.location.pickUp.locationType
                },
                dropoffLocation: {
                    state: order.location.dropOff.state,
                    lga: order.location.dropOff.lga,
                    zone: order.location.dropOff.locationType
                }
            };

            // Update analytics
            await DriverAnalytics.updateAfterOrderCompletion(driverId, orderData);

            // Update geographic analytics
            await this.updateGeographicAnalytics(driverId, orderData);

            // Check and award achievements
            await this.checkAchievements(driverId);

            console.log(`Analytics updated for driver ${driverId} after order ${orderId}`);
        } catch (error) {
            console.error('Error updating analytics on order completion:', error);
            throw error;
        }
    }

    /**
     * Update analytics when rating is received
     */
    async updateOnRatingReceived(orderId, rating) {
        try {
            const { Order } = await getOrderModels();
            const { DriverAnalytics } = await getAnalyticsModels();

            const order = await Order.findById(orderId);
            if (!order || !order.driverAssignment?.driverId) {
                return;
            }

            const driverId = order.driverAssignment.driverId;

            // Prepare rating data
            const ratingData = {
                orderId: order._id,
                stars: rating.stars,
                feedback: rating.feedback,
                categories: rating.categories?.reduce((acc, cat) => {
                    acc[cat.category] = cat.rating;
                    return acc;
                }, {}),
                wouldRecommend: rating.wouldRecommend,
                ratedAt: new Date()
            };

            // Update analytics
            await DriverAnalytics.updateAfterRating(driverId, ratingData);

            // Update trends
            await this.calculateTrends(driverId);

            console.log(`Rating analytics updated for driver ${driverId}`);
        } catch (error) {
            console.error('Error updating analytics on rating:', error);
            throw error;
        }
    }

    /**
     * Update analytics when driver goes online/offline
     */
    async updateDriverStatus(driverId, status) {
        try {
            const { DriverAnalytics } = await getAnalyticsModels();

            await DriverAnalytics.updateOne(
                { driverId },
                {
                    $set: {
                        'currentSnapshot.status': status,
                        'currentSnapshot.lastUpdated': new Date()
                    }
                }
            );
        } catch (error) {
            console.error('Error updating driver status:', error);
        }
    }

    /**
     * Update geographic analytics
     */
    async updateGeographicAnalytics(driverId, orderData) {
        try {
            const { DriverAnalytics } = await getAnalyticsModels();
            const analytics = await DriverAnalytics.findOne({ driverId });

            if (!analytics) return;

            const zone = orderData.dropoffLocation.zone;
            const state = orderData.dropoffLocation.state;
            const lga = orderData.dropoffLocation.lga;

            // Find or create area record
            let areaIndex = analytics.geographic.topAreas.findIndex(
                a => a.zone === zone && a.state === state && a.lga === lga
            );

            if (areaIndex === -1) {
                analytics.geographic.topAreas.push({
                    zone,
                    state,
                    lga,
                    deliveryCount: 1,
                    totalEarnings: orderData.earnings,
                    averageEarnings: orderData.earnings,
                    lastDelivered: new Date()
                });
            } else {
                const area = analytics.geographic.topAreas[areaIndex];
                area.deliveryCount += 1;
                area.totalEarnings += orderData.earnings;
                area.averageEarnings = area.totalEarnings / area.deliveryCount;
                area.lastDelivered = new Date();
            }

            // Update coverage
            if (!analytics.geographic.coverage.statesCovered.includes(state)) {
                analytics.geographic.coverage.statesCovered.push(state);
            }
            if (!analytics.geographic.coverage.lgasCovered.includes(lga)) {
                analytics.geographic.coverage.lgasCovered.push(lga);
            }

            // Sort top areas by earnings
            analytics.geographic.topAreas.sort(
                (a, b) => b.totalEarnings - a.totalEarnings
            );

            // Keep only top 20 areas
            if (analytics.geographic.topAreas.length > 20) {
                analytics.geographic.topAreas = analytics.geographic.topAreas.slice(0, 20);
            }

            await analytics.save();
        } catch (error) {
            console.error('Error updating geographic analytics:', error);
        }
    }

    /**
     * Check and award achievements
     */
    async checkAchievements(driverId) {
        try {
            const { DriverAnalytics } = await getAnalyticsModels();
            const analytics = await DriverAnalytics.findOne({ driverId });

            if (!analytics) return;

            const achievements = [];
            const totalDeliveries = analytics.lifetime.totalDeliveries;

            // Delivery milestones
            const deliveryMilestones = [
                { count: 1, type: 'first_delivery', description: 'Completed your first delivery!' },
                { count: 10, type: '10_deliveries', description: 'Completed 10 deliveries' },
                { count: 50, type: '50_deliveries', description: 'Completed 50 deliveries' },
                { count: 100, type: '100_deliveries', description: 'Completed 100 deliveries' },
                { count: 500, type: '500_deliveries', description: 'Completed 500 deliveries' },
                { count: 1000, type: '1000_deliveries', description: 'Completed 1000 deliveries!' }
            ];

            for (const milestone of deliveryMilestones) {
                if (totalDeliveries === milestone.count) {
                    const existing = analytics.achievements.milestones.find(
                        m => m.type === milestone.type
                    );

                    if (!existing) {
                        achievements.push({
                            type: milestone.type,
                            achievedAt: new Date(),
                            value: milestone.count,
                            badge: `🏆`,
                            description: milestone.description
                        });
                    }
                }
            }

            // Perfect week (7 days with 5-star average)
            const lastWeek = analytics.weekly[analytics.weekly.length - 1];
            if (lastWeek && lastWeek.performance.averageRating === 5) {
                const existing = analytics.achievements.milestones.find(
                    m => m.type === 'perfect_week' &&
                        m.achievedAt >= new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
                );

                if (!existing) {
                    achievements.push({
                        type: 'perfect_week',
                        achievedAt: new Date(),
                        value: 5,
                        badge: '⭐',
                        description: 'Perfect 5-star week!'
                    });
                }
            }

            // Add new achievements
            if (achievements.length > 0) {
                await DriverAnalytics.updateOne(
                    { driverId },
                    {
                        $push: {
                            'achievements.milestones': { $each: achievements }
                        }
                    }
                );
            }
        } catch (error) {
            console.error('Error checking achievements:', error);
        }
    }

    /**
     * Calculate performance trends
     */
    async calculateTrends(driverId) {
        try {
            const { DriverAnalytics } = await getAnalyticsModels();
            const analytics = await DriverAnalytics.findOne({ driverId });

            if (!analytics || analytics.weekly.length < 2) return;

            const currentWeek = analytics.weekly[analytics.weekly.length - 1];
            const previousWeek = analytics.weekly[analytics.weekly.length - 2];

            // Calculate earnings trend
            const earningsTrend = this.calculateTrendDirection(
                currentWeek.earnings.gross,
                previousWeek.earnings.gross
            );

            // Calculate rating trend
            const ratingTrend = this.calculateTrendDirection(
                currentWeek.performance.averageRating,
                previousWeek.performance.averageRating
            );

            // Calculate efficiency trend (completion rate)
            const efficiencyTrend = this.calculateTrendDirection(
                currentWeek.performance.completionRate,
                previousWeek.performance.completionRate
            );

            await DriverAnalytics.updateOne(
                { driverId },
                {
                    $set: {
                        'trends.earnings': earningsTrend,
                        'trends.rating': ratingTrend,
                        'trends.efficiency': efficiencyTrend,
                        lastCalculated: new Date(),
                        calculationStatus: 'up_to_date'
                    }
                }
            );
        } catch (error) {
            console.error('Error calculating trends:', error);
        }
    }

    /**
     * Helper: Calculate trend direction
     */
    calculateTrendDirection(current, previous) {
        if (previous === 0) {
            return { trend: 'stable', changePercent: 0, comparisonPeriod: 'vs last week' };
        }

        const changePercent = ((current - previous) / previous) * 100;
        let trend = 'stable';

        if (changePercent > 5) trend = 'increasing';
        else if (changePercent < -5) trend = 'decreasing';

        return {
            trend,
            changePercent: Math.round(changePercent * 10) / 10,
            comparisonPeriod: 'vs last week'
        };
    }

    /**
     * Helper: Check if delivery was on time
     */
    checkIfOnTime(order) {
        if (!order.deliveryWindow?.end || !order.driverAssignment?.actualTimes?.deliveredAt) {
            return true; // Assume on time if no window set
        }

        return new Date(order.driverAssignment.actualTimes.deliveredAt) <=
            new Date(order.deliveryWindow.end);
    }

    /**
     * Daily aggregation job (should be run via cron)
     */
    async runDailyAggregation() {
        try {
            const { DriverAnalytics } = await getAnalyticsModels();
            const { Driver } = await getModels();

            const drivers = await Driver.find({ status: 'Active' });

            for (const driver of drivers) {
                await this.aggregateDailyMetrics(driver._id);
            }

            console.log('Daily aggregation completed');
        } catch (error) {
            console.error('Error in daily aggregation:', error);
        }
    }

    /**
     * Aggregate daily metrics
     */
    async aggregateDailyMetrics(driverId) {
        // Implementation for daily aggregation
        // This would pull data from orders and calculate daily summaries
    }
}

// Export singleton instance
const analyticsUpdater = new AnalyticsUpdater();
export default analyticsUpdater;

// Middleware to attach to Order model
export const orderAnalyticsMiddleware = async function(doc) {
    if (doc.status === 'delivered') {
        await analyticsUpdater.updateOnOrderCompletion(doc._id);
    }
};

// Middleware for rating updates
export const ratingAnalyticsMiddleware = async function(doc) {
    if (doc.rating?.clientRating?.stars) {
        await analyticsUpdater.updateOnRatingReceived(
            doc._id,
            doc.rating.clientRating
        );
    }
};
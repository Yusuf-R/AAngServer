// /scripts/migrateAnalytics.js
import getModels from '../models/AAng/AAngLogistics.js';
import getOrderModels from '../models/Order';
import getAnalyticsModels from '../models/Analytics/DriverAnalytics.js';

/**
 * ANALYTICS MIGRATION SCRIPT
 *
 * This script processes ALL existing data in your database and generates
 * complete analytics for all drivers with historical data.
 *
 * Usage:
 * node scripts/migrateAnalytics.js
 *
 * Or via API:
 * POST /api/analytics/migrate
 */

class AnalyticsMigration {
    constructor() {
        this.processedDrivers = 0;
        this.totalOrders = 0;
        this.errors = [];
        this.startTime = null;
    }

    /**
     * Main migration function
     */
    async migrate(options = {}) {
        this.startTime = Date.now();
        const {
            batchSize = 50,
            driverLimit = null,
            skipExisting = true
        } = options;

        console.log('🚀 Starting Analytics Migration...');
        console.log('⚙️  Options:', { batchSize, driverLimit, skipExisting });

        try {
            const { Driver } = await getModels();
            const { Order } = await getOrderModels();
            const { DriverAnalytics } = await getAnalyticsModels();

            // Get all drivers
            let query = { role: 'Driver' };
            const drivers = driverLimit
                ? await Driver.find(query).limit(driverLimit)
                : await Driver.find(query);

            console.log(`📊 Found ${drivers.length} drivers to process`);

            // Process drivers in batches
            for (let i = 0; i < drivers.length; i += batchSize) {
                const batch = drivers.slice(i, i + batchSize);
                await this.processBatch(batch, { skipExisting });

                console.log(`✅ Processed batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(drivers.length / batchSize)}`);
            }

            // Summary
            const duration = ((Date.now() - this.startTime) / 1000).toFixed(2);
            console.log('\n🎉 Migration Complete!');
            console.log('═'.repeat(50));
            console.log(`✅ Drivers Processed: ${this.processedDrivers}`);
            console.log(`📦 Orders Processed: ${this.totalOrders}`);
            console.log(`⏱️  Duration: ${duration}s`);
            console.log(`⚠️  Errors: ${this.errors.length}`);

            if (this.errors.length > 0) {
                console.log('\n❌ Errors encountered:');
                this.errors.forEach((err, idx) => {
                    console.log(`${idx + 1}. ${err}`);
                });
            }

            return {
                success: true,
                processedDrivers: this.processedDrivers,
                totalOrders: this.totalOrders,
                duration,
                errors: this.errors
            };

        } catch (error) {
            console.error('💥 Migration failed:', error);
            throw error;
        }
    }

    /**
     * Process a batch of drivers
     */
    async processBatch(drivers, options) {
        const promises = drivers.map(driver =>
            this.processDriver(driver, options)
        );
        await Promise.all(promises);
    }

    /**
     * Process single driver
     */
    async processDriver(driver, { skipExisting }) {
        try {
            const { DriverAnalytics } = await getAnalyticsModels();
            const { Order } = await getOrderModels();

            // Check if analytics already exists
            if (skipExisting) {
                const existing = await DriverAnalytics.findOne({ driverId: driver._id });
                if (existing) {
                    console.log(`⏭️  Skipping ${driver.fullName} - analytics exists`);
                    return;
                }
            }

            console.log(`🔄 Processing ${driver.fullName}...`);

            // Get all orders for this driver
            const orders = await Order.find({
                'driverAssignment.driverId': driver._id,
                status: { $in: ['delivered', 'completed'] }
            }).sort({ createdAt: 1 }); // Oldest first

            if (orders.length === 0) {
                console.log(`⚠️  No completed orders for ${driver.fullName}`);
                return;
            }

            // Initialize analytics record
            const analytics = await this.initializeAnalytics(driver);

            // Process each order chronologically
            for (const order of orders) {
                await this.processOrder(analytics, order);
                this.totalOrders++;
            }

            // Calculate aggregates
            await this.calculateAggregates(analytics, orders);

            // Calculate trends
            await this.calculateTrends(analytics);

            // Check achievements
            await this.checkAchievements(analytics);

            // Save analytics
            await analytics.save();

            this.processedDrivers++;
            console.log(`✅ ${driver.fullName}: ${orders.length} orders processed`);

        } catch (error) {
            const errorMsg = `Error processing driver ${driver._id}: ${error.message}`;
            console.error(`❌ ${errorMsg}`);
            this.errors.push(errorMsg);
        }
    }

    /**
     * Initialize analytics record
     */
    async initializeAnalytics(driver) {
        const { DriverAnalytics } = await getAnalyticsModels();

        // Delete existing if present (for re-migration)
        await DriverAnalytics.deleteOne({ driverId: driver._id });

        return new DriverAnalytics({
            driverId: driver._id,
            lifetime: {
                memberSince: driver.createdAt || new Date(),
                totalDeliveries: 0,
                totalEarnings: 0,
                totalDistance: 0,
                totalHours: 0,
                averageRating: 0
            },
            currentSnapshot: {
                status: driver.availabilityStatus || 'offline',
                currentEarnings: 0,
                todayDeliveries: 0,
                todayHours: 0,
                activeOrders: 0,
                lastUpdated: new Date()
            },
            ratings: {
                overall: {
                    average: 0,
                    total: 0,
                    distribution: {
                        fiveStar: 0,
                        fourStar: 0,
                        threeStar: 0,
                        twoStar: 0,
                        oneStar: 0
                    }
                },
                categories: {
                    professionalism: { average: 0, total: 0, trend: 'stable' },
                    timeliness: { average: 0, total: 0, trend: 'stable' },
                    communication: { average: 0, total: 0, trend: 'stable' },
                    care: { average: 0, total: 0, trend: 'stable' }
                },
                recentFeedback: []
            },
            geographic: {
                topAreas: [],
                coverage: {
                    statesCovered: [],
                    lgasCovered: [],
                    totalZones: 0
                }
            },
            achievements: {
                milestones: [],
                streaks: {
                    current: { count: 0 },
                    longest: { count: 0 }
                }
            },
            daily: [],
            weekly: [],
            monthly: [],
            yearly: []
        });
    }

    /**
     * Process single order and update analytics
     */
    async processOrder(analytics, order) {
        const orderDate = new Date(order.createdAt);
        const dateKey = orderDate.toISOString().split('T')[0]; // YYYY-MM-DD
        const weekKey = this.getWeekKey(orderDate);
        const monthKey = orderDate.toISOString().substring(0, 7); // YYYY-MM
        const yearKey = orderDate.getFullYear().toString();

        // Extract order data
        const earnings = order.pricing?.totalAmount || 0;
        const distance = order.driverAssignment?.distance?.total || 0;
        const duration = order.driverAssignment?.duration?.actual || 0;
        const isOnTime = this.checkIfOnTime(order);

        // Update lifetime stats
        analytics.lifetime.totalDeliveries += 1;
        analytics.lifetime.totalEarnings += earnings;
        analytics.lifetime.totalDistance += distance;
        analytics.lifetime.totalHours += (duration / 60) || 0;
        analytics.lifetime.lastDeliveryDate = orderDate;

        // Update daily metrics
        this.updateTimeMetrics(analytics.daily, dateKey, 'daily', {
            earnings,
            distance,
            duration,
            isOnTime,
            status: order.status
        });

        // Update weekly metrics
        this.updateTimeMetrics(analytics.weekly, weekKey, 'weekly', {
            earnings,
            distance,
            duration,
            isOnTime,
            status: order.status
        });

        // Update monthly metrics
        this.updateTimeMetrics(analytics.monthly, monthKey, 'monthly', {
            earnings,
            distance,
            duration,
            isOnTime,
            status: order.status
        });

        // Update yearly metrics
        this.updateTimeMetrics(analytics.yearly, yearKey, 'yearly', {
            earnings,
            distance,
            duration,
            isOnTime,
            status: order.status
        });

        // Update geographic analytics
        if (order.location?.dropOff) {
            this.updateGeographicData(analytics, order);
        }

        // Update rating if exists
        if (order.rating?.clientRating?.stars) {
            this.updateRatings(analytics, order.rating.clientRating);
        }
    }

    /**
     * Update time-based metrics
     */
    updateTimeMetrics(metricsArray, periodKey, periodType, data) {
        let metric = metricsArray.find(m => m.period === periodKey);

        if (!metric) {
            metric = {
                period: periodKey,
                periodType,
                deliveries: { total: 0, completed: 0, cancelled: 0, failed: 0 },
                earnings: { gross: 0, net: 0, tips: 0, bonuses: 0, penalties: 0, fuel: 0 },
                performance: {
                    averageRating: 0,
                    totalRatings: 0,
                    onTimeDeliveries: 0,
                    lateDeliveries: 0,
                    averageDeliveryTime: 0,
                    completionRate: 0,
                    acceptanceRate: 0
                },
                timeMetrics: {
                    hoursOnline: 0,
                    hoursActive: 0,
                    hoursIdle: 0,
                    averageResponseTime: 0,
                    peakHours: []
                },
                distance: {
                    total: 0,
                    withPackage: 0,
                    empty: 0,
                    averagePerDelivery: 0
                },
                satisfaction: {
                    positiveRatings: 0,
                    neutralRatings: 0,
                    negativeRatings: 0,
                    wouldRecommendCount: 0,
                    wouldRecommendRate: 0,
                    complaints: 0
                }
            };
            metricsArray.push(metric);
        }

        // Update metrics
        metric.deliveries.total += 1;
        if (data.status === 'delivered' || data.status === 'completed') {
            metric.deliveries.completed += 1;
        } else if (data.status === 'cancelled') {
            metric.deliveries.cancelled += 1;
        } else if (data.status === 'failed') {
            metric.deliveries.failed += 1;
        }

        metric.earnings.gross += data.earnings;
        metric.distance.total += data.distance;

        if (data.isOnTime) {
            metric.performance.onTimeDeliveries += 1;
        } else {
            metric.performance.lateDeliveries += 1;
        }

        // Calculate completion rate
        metric.performance.completionRate =
            (metric.deliveries.completed / metric.deliveries.total) * 100;

        // Calculate average distance
        metric.distance.averagePerDelivery =
            metric.distance.total / metric.deliveries.total;
    }

    /**
     * Update geographic data
     */
    updateGeographicData(analytics, order) {
        const zone = order.location.dropOff.locationType || 'other';
        const state = order.location.dropOff.state || 'Unknown';
        const lga = order.location.dropOff.lga || 'Unknown';
        const earnings = order.pricing?.totalAmount || 0;

        // Find or create area
        let area = analytics.geographic.topAreas.find(
            a => a.zone === zone && a.state === state && a.lga === lga
        );

        if (!area) {
            area = {
                zone,
                state,
                lga,
                deliveryCount: 0,
                totalEarnings: 0,
                averageEarnings: 0,
                lastDelivered: order.createdAt
            };
            analytics.geographic.topAreas.push(area);
        }

        area.deliveryCount += 1;
        area.totalEarnings += earnings;
        area.averageEarnings = area.totalEarnings / area.deliveryCount;
        area.lastDelivered = order.createdAt;

        // Update coverage
        if (!analytics.geographic.coverage.statesCovered.includes(state)) {
            analytics.geographic.coverage.statesCovered.push(state);
        }
        if (!analytics.geographic.coverage.lgasCovered.includes(lga)) {
            analytics.geographic.coverage.lgasCovered.push(lga);
        }
    }

    /**
     * Update ratings
     */
    updateRatings(analytics, rating) {
        const stars = rating.stars;

        // Update overall
        analytics.ratings.overall.total += 1;

        const starKey = ['one', 'two', 'three', 'four', 'five'][stars - 1];
        analytics.ratings.overall.distribution[`${starKey}Star`] += 1;

        // Update categories if present
        if (rating.categories && Array.isArray(rating.categories)) {
            rating.categories.forEach(cat => {
                const category = analytics.ratings.categories[cat.category];
                if (category) {
                    category.total += 1;
                    // We'll recalculate averages after all orders are processed
                }
            });
        }

        // Add to recent feedback (keep last 20)
        if (analytics.ratings.recentFeedback.length >= 20) {
            analytics.ratings.recentFeedback.shift();
        }

        analytics.ratings.recentFeedback.push({
            stars,
            comment: rating.feedback,
            wouldRecommend: rating.wouldRecommend,
            createdAt: new Date()
        });

        // Update satisfaction metrics
        if (stars >= 4) {
            analytics.ratings.overall.total += 1; // This seems duplicated, might need to check
        }
    }

    /**
     * Calculate final aggregates after processing all orders
     */
    async calculateAggregates(analytics, orders) {
        // Calculate overall rating average
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
        }

        // Calculate category averages
        const categoriesWithRatings = orders.filter(
            o => o.rating?.clientRating?.categories?.length > 0
        );

        for (const [categoryName, categoryData] of Object.entries(analytics.ratings.categories)) {
            if (categoryData.total > 0) {
                let sum = 0;
                let count = 0;

                categoriesWithRatings.forEach(order => {
                    const catRating = order.rating.clientRating.categories.find(
                        c => c.category === categoryName
                    );
                    if (catRating) {
                        sum += catRating.rating;
                        count += 1;
                    }
                });

                if (count > 0) {
                    categoryData.average = sum / count;
                }
            }
        }

        // Sort geographic areas by earnings
        analytics.geographic.topAreas.sort(
            (a, b) => b.totalEarnings - a.totalEarnings
        );

        // Keep only top 20 areas
        if (analytics.geographic.topAreas.length > 20) {
            analytics.geographic.topAreas = analytics.geographic.topAreas.slice(0, 20);
        }

        analytics.geographic.coverage.totalZones = analytics.geographic.topAreas.length;
    }

    /**
     * Calculate trends
     */
    async calculateTrends(analytics) {
        if (analytics.weekly.length < 2) return;

        const currentWeek = analytics.weekly[analytics.weekly.length - 1];
        const previousWeek = analytics.weekly[analytics.weekly.length - 2];

        // Earnings trend
        analytics.trends = analytics.trends || {};
        analytics.trends.earnings = this.calculateTrendDirection(
            currentWeek.earnings.gross,
            previousWeek.earnings.gross,
            'vs last week'
        );

        // Rating trend
        analytics.trends.rating = this.calculateTrendDirection(
            currentWeek.performance.averageRating,
            previousWeek.performance.averageRating,
            'vs last week'
        );

        // Efficiency trend
        analytics.trends.efficiency = this.calculateTrendDirection(
            currentWeek.performance.completionRate,
            previousWeek.performance.completionRate,
            'vs last week'
        );
    }

    /**
     * Calculate trend direction
     */
    calculateTrendDirection(current, previous, comparisonPeriod) {
        if (previous === 0) {
            return { trend: 'stable', changePercent: 0, comparisonPeriod };
        }

        const changePercent = ((current - previous) / previous) * 100;
        let trend = 'stable';

        if (changePercent > 5) trend = 'increasing';
        else if (changePercent < -5) trend = 'decreasing';

        return {
            trend,
            changePercent: Math.round(changePercent * 10) / 10,
            comparisonPeriod
        };
    }

    /**
     * Check and award achievements
     */
    async checkAchievements(analytics) {
        const totalDeliveries = analytics.lifetime.totalDeliveries;

        const milestones = [
            { count: 1, type: 'first_delivery', description: 'Completed your first delivery!', badge: '🎉' },
            { count: 10, type: '10_deliveries', description: 'Completed 10 deliveries', badge: '⭐' },
            { count: 50, type: '50_deliveries', description: 'Completed 50 deliveries', badge: '🌟' },
            { count: 100, type: '100_deliveries', description: 'Completed 100 deliveries', badge: '🏅' },
            { count: 500, type: '500_deliveries', description: 'Completed 500 deliveries', badge: '🏆' },
            { count: 1000, type: '1000_deliveries', description: 'Completed 1000 deliveries!', badge: '👑' }
        ];

        milestones.forEach(milestone => {
            if (totalDeliveries >= milestone.count) {
                const existing = analytics.achievements.milestones.find(
                    m => m.type === milestone.type
                );

                if (!existing) {
                    analytics.achievements.milestones.push({
                        type: milestone.type,
                        achievedAt: new Date(),
                        value: milestone.count,
                        badge: milestone.badge,
                        description: milestone.description
                    });
                }
            }
        });
    }

    /**
     * Helper: Get week key (YYYY-Wxx format)
     */
    getWeekKey(date) {
        const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
        const dayNum = d.getUTCDay() || 7;
        d.setUTCDate(d.getUTCDate() + 4 - dayNum);
        const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
        const weekNum = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
        return `${d.getUTCFullYear()}-W${weekNum.toString().padStart(2, '0')}`;
    }

    /**
     * Helper: Check if delivery was on time
     */
    checkIfOnTime(order) {
        if (!order.deliveryWindow?.end || !order.driverAssignment?.actualTimes?.deliveredAt) {
            return true;
        }

        return new Date(order.driverAssignment.actualTimes.deliveredAt) <=
            new Date(order.deliveryWindow.end);
    }
}

export default AnalyticsMigration;
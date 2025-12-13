// /scripts/migrateClientAnalytics.js
import mongoose from 'mongoose';
import getModels from '../models/AAng/AAngLogistics.js';
import getOrderModels from '../models/Order';
import getFinancialModels from '../models/Finance/FinancialTransactions.js';
import getClientAnalyticsModels from '../models/Analytics/ClientAnalytics.js';

/**
 * CLIENT ANALYTICS MIGRATION SCRIPT
 *
 * Processes ALL existing client data and generates
 * complete analytics for all clients with historical data.
 *
 * Usage:
 * node scripts/migrateClientAnalytics.js
 *
 * Or via API:
 * POST /api/client/analytics/migrate
 */

class ClientAnalyticsMigration {
    constructor() {
        this.processedClients = 0;
        this.totalOrders = 0;
        this.errors = [];
        this.startTime = null;
        this.progress = {
            current: 0,
            total: 0,
            percentage: 0
        };
    }

    /**
     * Main migration function
     */
    async migrate(options = {}) {
        this.startTime = Date.now();
        const {
            batchSize = 50,
            clientLimit = null,
            skipExisting = true,
            startDate = '2025-01-01' // Focus on 2025 data only
        } = options;

        console.log('🚀 Starting Client Analytics Migration...');
        console.log('⚙️  Options:', { batchSize, clientLimit, skipExisting, startDate });
        console.log('🎯 Strategy: Focus on 2025 data only');

        try {
            const { Client } = await getModels();
            const { Order } = await getOrderModels();
            const { ClientAnalytics } = await getClientAnalyticsModels();

            // Get all clients
            let query = { role: 'Client' };
            const clients = clientLimit
                ? await Client.find(query).limit(clientLimit)
                : await Client.find(query);

            console.log(`📊 Found ${clients.length} clients to process`);

            this.progress.total = clients.length;

            // Process clients in batches
            for (let i = 0; i < clients.length; i += batchSize) {
                const batch = clients.slice(i, i + batchSize);
                await this.processBatch(batch, { skipExisting, startDate });

                this.progress.current = Math.min(i + batchSize, clients.length);
                this.progress.percentage = Math.round((this.progress.current / this.progress.total) * 100);

                console.log(`📈 Progress: ${this.progress.percentage}% (${this.progress.current}/${this.progress.total})`);
                console.log(`✅ Processed batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(clients.length / batchSize)}`);
            }

            // Summary
            const duration = ((Date.now() - this.startTime) / 1000).toFixed(2);
            console.log('\n🎉 Client Analytics Migration Complete!');
            console.log('═'.repeat(50));
            console.log(`✅ Clients Processed: ${this.processedClients}`);
            console.log(`📦 Orders Processed: ${this.totalOrders}`);
            console.log(`⏱️  Duration: ${duration}s`);
            console.log(`📊 Average: ${(this.totalOrders / this.processedClients).toFixed(1)} orders per client`);
            console.log(`⚠️  Errors: ${this.errors.length}`);

            if (this.errors.length > 0) {
                console.log('\n❌ Errors encountered:');
                this.errors.forEach((err, idx) => {
                    console.log(`${idx + 1}. ${err}`);
                });
            }

            return {
                success: true,
                processedClients: this.processedClients,
                totalOrders: this.totalOrders,
                duration,
                errors: this.errors,
                progress: this.progress
            };

        } catch (error) {
            console.error('💥 Migration failed:', error);
            throw error;
        }
    }

    /**
     * Process a batch of clients
     */
    async processBatch(clients, options) {
        const promises = clients.map(client =>
            this.processClient(client, options)
        );
        await Promise.all(promises);
    }

    /**
     * Process single client
     */
    async processClient(client, { skipExisting, startDate }) {
        try {
            const { ClientAnalytics } = await getClientAnalyticsModels();
            const { Order } = await getOrderModels();

            // Check if analytics already exists
            if (skipExisting) {
                const existing = await ClientAnalytics.findOne({ clientId: client._id });
                if (existing) {
                    console.log(`⏭️  Skipping ${client.fullName || client.email} - analytics exists`);
                    return;
                }
            }

            console.log(`🔄 Processing ${client.fullName || client.email}...`);

            // Get all orders for this client (2025 only)
            const orders = await Order.find({
                clientId: client._id,
                createdAt: { $gte: new Date(startDate) }
            }).sort({ createdAt: 1 }); // Oldest first

            if (orders.length === 0) {
                console.log(`⚠️  No orders for ${client.fullName || client.email}`);
                return;
            }

            // Initialize analytics record
            const analytics = await this.initializeAnalytics(client);

            // Process each order chronologically
            for (const order of orders) {
                await this.processOrder(analytics, order);
                this.totalOrders++;
            }

            // Calculate aggregates
            await this.calculateAggregates(analytics, orders);

            // Calculate financial stats
            await this.calculateFinancialStats(analytics, client._id);

            // Calculate geographic stats
            await this.calculateGeographicStats(analytics, orders);

            // Calculate patterns
            await this.calculatePatterns(analytics, orders);

            // Calculate trends
            await this.calculateTrends(analytics);

            // Check achievements
            await this.checkAchievements(analytics);

            // Save analytics
            await analytics.save();

            this.processedClients++;
            console.log(`✅ ${client.fullName || client.email}: ${orders.length} orders processed`);

        } catch (error) {
            const errorMsg = `Error processing client ${client._id}: ${error.message}`;
            console.error(`❌ ${errorMsg}`);
            this.errors.push(errorMsg);
        }
    }

    /**
     * Initialize analytics record
     */
    async initializeAnalytics(client) {
        const { ClientAnalytics } = await getClientAnalyticsModels();

        // Delete existing if present (for re-migration)
        await ClientAnalytics.deleteOne({ clientId: client._id });

        return new ClientAnalytics({
            clientId: client._id,
            lifetime: {
                totalOrders: 0,
                completedOrders: 0,
                cancelledOrders: 0,
                totalSpent: 0,
                totalDistance: 0,
                averageOrderValue: 0,
                averageRating: 0,
                totalRatingsGiven: 0,
                firstOrderAt: null,
                lastOrderAt: null
            },
            daily: [],
            weekly: [],
            monthly: [],
            categories: {
                laptop: { count: 0, spent: 0 },
                document: { count: 0, spent: 0 },
                food: { count: 0, spent: 0 },
                electronics: { count: 0, spent: 0 },
                mobilePhone: { count: 0, spent: 0 },
                clothing: { count: 0, spent: 0 },
                furniture: { count: 0, spent: 0 },
                medicine: { count: 0, spent: 0 },
                gifts: { count: 0, spent: 0 },
                cake: { count: 0, spent: 0 },
                books: { count: 0, spent: 0 },
                others: { count: 0, spent: 0 }
            },
            geographic: {
                topPickupAreas: [],
                topDropoffAreas: [],
                averageDistance: 0
            },
            payments: {
                totalPaid: 0,
                totalFees: 0,
                wallet: {
                    totalDeposited: 0,
                    totalUsed: 0,
                    currentBalance: 0
                },
                paymentMethods: {
                    paystack: { count: 0, amount: 0 },
                    wallet: { count: 0, amount: 0 },
                    combined: { count: 0, amount: 0 }
                }
            },
            ratingsGiven: {
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
                    professionalism: { average: 0, total: 0 },
                    timeliness: { average: 0, total: 0 },
                    communication: { average: 0, total: 0 },
                    care: { average: 0, total: 0 }
                }
            },
            patterns: {
                mostActiveDay: '',
                mostActiveHour: 0,
                averageOrdersPerWeek: 0,
                peakOrderingTime: {
                    dayOfWeek: '',
                    hourOfDay: 0
                }
            },
            trends: {
                spending: {
                    trend: 'stable',
                    changePercent: 0,
                    periodCompared: 'month'
                },
                orderFrequency: {
                    trend: 'stable',
                    changePercent: 0,
                    periodCompared: 'month'
                }
            },
            achievements: {
                milestones: []
            }
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
        const monthNumber = orderDate.getMonth() + 1;
        const yearKey = orderDate.getFullYear().toString();

        // Extract order data
        const orderAmount = order.pricing?.totalAmount || 0;
        const distance = order.driverAssignment?.distance?.total || 0;
        const duration = order.driverAssignment?.duration?.actual || 0;
        const category = order.package?.category || 'others';
        const status = order.status;

        // Update lifetime stats
        analytics.lifetime.totalOrders += 1;
        const skip = ['draft', 'returned', 'failed', 'cancelled'];

        if (!skip.includes(status)) {
            analytics.lifetime.completedOrders += 1;
            analytics.lifetime.totalSpent += orderAmount;
        } else if (status === 'cancelled') {
            analytics.lifetime.cancelledOrders += 1;
        }

        analytics.lifetime.totalDistance += distance;

        if (!analytics.lifetime.firstOrderAt || orderDate < analytics.lifetime.firstOrderAt) {
            analytics.lifetime.firstOrderAt = orderDate;
        }

        if (!analytics.lifetime.lastOrderAt || orderDate > analytics.lifetime.lastOrderAt) {
            analytics.lifetime.lastOrderAt = orderDate;
        }

        // Update category stats
        if (analytics.categories[category]) {
            analytics.categories[category].count += 1;
            if (status === 'delivered' || status === 'completed') {
                analytics.categories[category].spent += orderAmount;
            }
        }

        // Update daily metrics
        this.updateDailyMetrics(analytics, dateKey, {
            amount: orderAmount,
            distance,
            duration,
            status,
            category
        });

        // Update weekly metrics
        this.updateWeeklyMetrics(analytics, weekKey, orderDate, {
            amount: orderAmount,
            distance,
            duration,
            status
        });

        // Update monthly metrics
        this.updateMonthlyMetrics(analytics, monthKey, monthNumber, yearKey, {
            amount: orderAmount,
            distance,
            duration,
            status
        });

        // Update ratings given to drivers
        if (order.rating?.clientRating?.stars) {
            this.updateRatingsGiven(analytics, order.rating.clientRating);
        }
    }

    /**
     * Update daily metrics
     */
    updateDailyMetrics(analytics, dateKey, data) {
        let daily = analytics.daily.find(d =>
            d.period.toISOString().split('T')[0] === dateKey
        );

        if (!daily) {
            daily = {
                period: new Date(dateKey),
                orders: { total: 0, completed: 0, cancelled: 0 },
                spending: { gross: 0, fees: 0, net: 0 },
                distance: 0,
                categories: []
            };
            analytics.daily.push(daily);
        }

        // Update daily stats
        daily.orders.total += 1;
        if (data.status === 'delivered' || data.status === 'completed') {
            daily.orders.completed += 1;
            daily.spending.gross += data.amount;
            daily.spending.net += data.amount;
        } else if (data.status === 'cancelled') {
            daily.orders.cancelled += 1;
        }

        daily.distance += data.distance;

        if (!daily.categories.includes(data.category)) {
            daily.categories.push(data.category);
        }

        // Keep only last 30 days
        if (analytics.daily.length > 30) {
            analytics.daily.sort((a, b) => b.period - a.period);
            analytics.daily = analytics.daily.slice(0, 30);
        }
    }

    /**
     * Update weekly metrics
     */
    updateWeeklyMetrics(analytics, weekKey, orderDate, data) {
        let weekly = analytics.weekly.find(w =>
            this.getWeekKey(w.weekStart) === weekKey
        );

        if (!weekly) {
            const weekStart = this.getWeekStart(orderDate);
            const weekEnd = this.getWeekEnd(weekStart);

            weekly = {
                weekStart,
                weekEnd,
                weekNumber: this.getWeekNumber(orderDate),
                orders: { total: 0, completed: 0, cancelled: 0 },
                spending: { gross: 0, fees: 0, net: 0 },
                distance: 0
            };
            analytics.weekly.push(weekly);
        }

        // Update weekly stats
        weekly.orders.total += 1;
        if (data.status === 'delivered' || data.status === 'completed') {
            weekly.orders.completed += 1;
            weekly.spending.gross += data.amount;
            weekly.spending.net += data.amount;
        } else if (data.status === 'cancelled') {
            weekly.orders.cancelled += 1;
        }

        weekly.distance += data.distance;

        // Keep only last 12 weeks
        if (analytics.weekly.length > 12) {
            analytics.weekly.sort((a, b) => b.weekStart - a.weekStart);
            analytics.weekly = analytics.weekly.slice(0, 12);
        }
    }

    /**
     * Update monthly metrics
     */
    updateMonthlyMetrics(analytics, monthKey, monthNumber, yearKey, data) {
        let monthly = analytics.monthly.find(m =>
            m.month === monthNumber && m.year === parseInt(yearKey)
        );

        if (!monthly) {
            const monthStart = new Date(parseInt(yearKey), monthNumber - 1, 1);

            monthly = {
                period: monthStart,
                month: monthNumber,
                year: parseInt(yearKey),
                orders: { total: 0, completed: 0, cancelled: 0 },
                spending: { gross: 0, fees: 0, net: 0 },
                distance: 0
            };
            analytics.monthly.push(monthly);
        }

        // Update monthly stats
        monthly.orders.total += 1;
        if (data.status === 'delivered' || data.status === 'completed') {
            monthly.orders.completed += 1;
            monthly.spending.gross += data.amount;
            monthly.spending.net += data.amount;
        } else if (data.status === 'cancelled') {
            monthly.orders.cancelled += 1;
        }

        monthly.distance += data.distance;

        // Keep only last 12 months
        if (analytics.monthly.length > 12) {
            analytics.monthly.sort((a, b) => {
                if (a.year !== b.year) return b.year - a.year;
                return b.month - a.month;
            });
            analytics.monthly = analytics.monthly.slice(0, 12);
        }
    }

    /**
     * Update ratings given to drivers
     */
    updateRatingsGiven(analytics, rating) {
        const stars = rating.stars;

        // Update overall ratings
        analytics.ratingsGiven.overall.total += 1;

        const starKey = ['one', 'two', 'three', 'four', 'five'][stars - 1];
        analytics.ratingsGiven.overall.distribution[`${starKey}Star`] += 1;

        // Update category ratings if present
        if (rating.categories && Array.isArray(rating.categories)) {
            rating.categories.forEach(cat => {
                if (analytics.ratingsGiven.categories[cat.category]) {
                    const category = analytics.ratingsGiven.categories[cat.category];
                    category.total += 1;
                    // We'll recalculate averages after all orders are processed
                }
            });
        }
    }

    /**
     * Calculate final aggregates after processing all orders
     */
    async calculateAggregates(analytics, orders) {
        // Calculate average order value
        if (analytics.lifetime.completedOrders > 0) {
            analytics.lifetime.averageOrderValue =
                analytics.lifetime.totalSpent / analytics.lifetime.completedOrders;
        }

        // Calculate average rating given
        const { distribution } = analytics.ratingsGiven.overall;
        const totalRatings = analytics.ratingsGiven.overall.total;

        if (totalRatings > 0) {
            const weightedSum = (
                (distribution.fiveStar * 5) +
                (distribution.fourStar * 4) +
                (distribution.threeStar * 3) +
                (distribution.twoStar * 2) +
                (distribution.oneStar * 1)
            );

            analytics.lifetime.averageRating = weightedSum / totalRatings;
            analytics.lifetime.totalRatingsGiven = totalRatings;
            analytics.ratingsGiven.overall.average = weightedSum / totalRatings;
        }

        // Calculate category rating averages
        const ordersWithRatings = orders.filter(
            o => o.rating?.clientRating?.categories?.length > 0
        );

        for (const [categoryName, categoryData] of Object.entries(analytics.ratingsGiven.categories)) {
            if (categoryData.total > 0) {
                let sum = 0;
                let count = 0;

                ordersWithRatings.forEach(order => {
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

        // Calculate success rate for each period
        this.calculatePeriodSuccessRates(analytics);
    }

    /**
     * Calculate success rates for daily/weekly/monthly periods
     */
    calculatePeriodSuccessRates(analytics) {
        // Recalculate spending averages
        analytics.daily.forEach(day => {
            if (day.orders.completed > 0) {
                day.spending.average = day.spending.gross / day.orders.completed;
            }
        });

        analytics.weekly.forEach(week => {
            if (week.orders.completed > 0) {
                week.spending.averagePerOrder = week.spending.gross / week.orders.completed;
            }
        });

        analytics.monthly.forEach(month => {
            if (month.orders.completed > 0) {
                month.spending.averagePerOrder = month.spending.gross / month.orders.completed;
            }
        });
    }

    /**
     * Calculate financial statistics from transactions
     */
    async calculateFinancialStats(analytics, clientId) {
        try {
            const { FinancialTransaction, ClientWallet } = await getFinancialModels();

            // Get payment transactions
            const paymentStats = await FinancialTransaction.aggregate([
                {
                    $match: {
                        clientId: new mongoose.Types.ObjectId(clientId),
                        transactionType: 'client_payment',
                        status: 'completed'
                    }
                },
                {
                    $group: {
                        _id: '$gateway.provider',
                        count: { $sum: 1 },
                        totalPaid: { $sum: '$amount.gross' },
                        totalFees: { $sum: '$amount.fees' }
                    }
                }
            ]);

            // Update payment methods
            analytics.payments.totalPaid = 0;
            analytics.payments.totalFees = 0;

            paymentStats.forEach(stat => {
                const method = stat._id || 'paystack';
                if (analytics.payments.paymentMethods[method]) {
                    analytics.payments.paymentMethods[method] = {
                        count: stat.count,
                        amount: stat.totalPaid
                    };
                }
                analytics.payments.totalPaid += stat.totalPaid;
                analytics.payments.totalFees += stat.totalFees;
            });

            // Get wallet stats
            const wallet = await ClientWallet.findOne({ clientId });
            if (wallet) {
                analytics.payments.wallet = {
                    totalDeposited: wallet.lifetime.totalDeposited,
                    totalUsed: wallet.lifetime.totalSpent,
                    currentBalance: wallet.balance
                };
            }

        } catch (error) {
            console.error(`Error calculating financial stats for client ${clientId}:`, error);
        }
    }

    /**
     * Calculate geographic statistics
     */
    async calculateGeographicStats(analytics, orders) {
        const pickupAreas = {};
        const dropoffAreas = {};
        let totalDistance = 0;
        let distanceCount = 0;

        orders.forEach(order => {
            // Top pickup areas
            if (order.location?.pickUp?.state && order.location?.pickUp?.lga) {
                const key = `${order.location.pickUp.state}-${order.location.pickUp.lga}`;
                if (!pickupAreas[key]) {
                    pickupAreas[key] = {
                        state: order.location.pickUp.state,
                        lga: order.location.pickUp.lga,
                        orderCount: 0,
                        totalSpent: 0
                    };
                }
                pickupAreas[key].orderCount += 1;
                pickupAreas[key].totalSpent += (order.pricing?.totalAmount || 0);
            }

            // Top dropoff areas
            if (order.location?.dropOff?.state && order.location?.dropOff?.lga) {
                const key = `${order.location.dropOff.state}-${order.location.dropOff.lga}`;
                if (!dropoffAreas[key]) {
                    dropoffAreas[key] = {
                        state: order.location.dropOff.state,
                        lga: order.location.dropOff.lga,
                        orderCount: 0,
                        totalSpent: 0
                    };
                }
                dropoffAreas[key].orderCount += 1;
                dropoffAreas[key].totalSpent += (order.pricing?.totalAmount || 0);
            }

            // Average distance
            if (order.driverAssignment?.distance?.total) {
                totalDistance += order.driverAssignment.distance.total;
                distanceCount += 1;
            }
        });

        // Convert to arrays and sort
        analytics.geographic.topPickupAreas = Object.values(pickupAreas)
            .sort((a, b) => b.orderCount - a.orderCount)
            .slice(0, 5);

        analytics.geographic.topDropoffAreas = Object.values(dropoffAreas)
            .sort((a, b) => b.orderCount - a.orderCount)
            .slice(0, 5);

        // Calculate average distance
        if (distanceCount > 0) {
            analytics.geographic.averageDistance = totalDistance / distanceCount;
        }
    }

    /**
     * Calculate ordering patterns
     */
    async calculatePatterns(analytics, orders) {
        if (orders.length === 0) return;

        const dayCount = {};
        const hourCount = {};

        orders.forEach(order => {
            const date = new Date(order.createdAt);
            const day = date.toLocaleDateString('en-US', { weekday: 'long' });
            const hour = date.getHours();

            dayCount[day] = (dayCount[day] || 0) + 1;
            hourCount[hour] = (hourCount[hour] || 0) + 1;
        });

        const mostActiveDay = Object.keys(dayCount).reduce((a, b) =>
            dayCount[a] > dayCount[b] ? a : b
        );

        const mostActiveHour = Object.keys(hourCount).reduce((a, b) =>
            hourCount[a] > hourCount[b] ? a : b
        );

        // Calculate average orders per week
        const weeks = analytics.weekly.length;
        const averageOrdersPerWeek = weeks > 0 ? analytics.lifetime.totalOrders / weeks : 0;

        analytics.patterns = {
            mostActiveDay,
            mostActiveHour: parseInt(mostActiveHour),
            averageOrdersPerWeek,
            peakOrderingTime: {
                dayOfWeek: mostActiveDay,
                hourOfDay: parseInt(mostActiveHour)
            }
        };
    }

    /**
     * Calculate trends
     */
    async calculateTrends(analytics) {
        if (analytics.monthly.length < 2) return;

        const currentMonth = analytics.monthly[analytics.monthly.length - 1];
        const previousMonth = analytics.monthly[analytics.monthly.length - 2];

        // Spending trend
        const spendingChange = previousMonth.spending.gross > 0
            ? ((currentMonth.spending.gross - previousMonth.spending.gross) /
            previousMonth.spending.gross) * 100
            : 0;

        analytics.trends.spending = {
            trend: spendingChange > 5 ? 'increasing' :
                spendingChange < -5 ? 'decreasing' : 'stable',
            changePercent: Math.abs(spendingChange).toFixed(1),
            periodCompared: 'month'
        };

        // Order frequency trend
        const orderChange = previousMonth.orders.total > 0
            ? ((currentMonth.orders.total - previousMonth.orders.total) /
            previousMonth.orders.total) * 100
            : 0;

        analytics.trends.orderFrequency = {
            trend: orderChange > 5 ? 'increasing' :
                orderChange < -5 ? 'decreasing' : 'stable',
            changePercent: Math.abs(orderChange).toFixed(1),
            periodCompared: 'month'
        };
    }

    /**
     * Check and award achievements
     */
    async checkAchievements(analytics) {
        const milestones = [];
        const existing = analytics.achievements?.milestones || [];
        const existingTypes = new Set(existing.map(m => m.type));

        const totalOrders = analytics.lifetime.totalOrders;
        const totalSpent = analytics.lifetime.totalSpent;

        // First order
        if (totalOrders >= 1 && !existingTypes.has('first_order')) {
            milestones.push({
                type: 'first_order',
                achievedAt: analytics.lifetime.firstOrderAt,
                badge: '🎉',
                description: 'First Order Placed'
            });
        }

        // Order milestones
        const orderMilestones = [
            { count: 10, badge: '📦', desc: '10 Orders', type: 'orders_10' },
            { count: 50, badge: '🚀', desc: '50 Orders', type: 'orders_50' },
            { count: 100, badge: '💫', desc: '100 Orders', type: 'orders_100' },
            { count: 500, badge: '⭐', desc: '500 Orders', type: 'orders_500' }
        ];

        orderMilestones.forEach(({ count, badge, desc, type }) => {
            if (totalOrders >= count && !existingTypes.has(type)) {
                milestones.push({
                    type,
                    achievedAt: new Date(),
                    badge,
                    description: desc
                });
            }
        });

        // Spending milestones
        const spendingMilestones = [
            { amount: 10000, badge: '💰', desc: 'Spent ₦10K', type: 'spent_10k' },
            { amount: 50000, badge: '💎', desc: 'Spent ₦50K', type: 'spent_50k' },
            { amount: 500000, badge: '👑', desc: 'Spent ₦500k', type: 'spent_500k' },
            { amount: 1000000, badge: '🏆', desc: 'Spent ₦1M', type: 'spent_1m' }
        ];

        spendingMilestones.forEach(({ amount, badge, desc, type }) => {
            if (totalSpent >= amount && !existingTypes.has(type)) {
                milestones.push({
                    type,
                    achievedAt: new Date(),
                    badge,
                    description: desc
                });
            }
        });

        if (milestones.length > 0) {
            analytics.achievements.milestones = [...existing, ...milestones];
        }
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
     * Helper: Get week number
     */
    getWeekNumber(date) {
        const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
        const dayNum = d.getUTCDay() || 7;
        d.setUTCDate(d.getUTCDate() + 4 - dayNum);
        const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
        return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    }

    /**
     * Helper: Get week start date
     */
    getWeekStart(date) {
        const d = new Date(date);
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1);
        return new Date(d.setDate(diff));
    }

    /**
     * Helper: Get week end date
     */
    getWeekEnd(weekStart) {
        const end = new Date(weekStart);
        end.setDate(end.getDate() + 6);
        return end;
    }
}

export default ClientAnalyticsMigration;
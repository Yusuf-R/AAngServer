// /utils/clientAnalyticsUpdater.js
import mongoose from 'mongoose';
import getClientAnalyticsModels from '../models/Analytics/ClientAnalytics.js';
import getOrderModels from '../models/Order';
import getFinancialModels from '../models/Finance/FinancialTransactions.js';

class ClientAnalyticsUpdater {

    /**
     * Update client analytics when order is created/completed
     */
    static async updateOrderAnalytics(orderId) {
        try {
            const { Order } = await getOrderModels();
            const { ClientAnalytics } = await getClientAnalyticsModels();
            const { FinancialTransaction, ClientWallet } = await getFinancialModels();

            const order = await Order.findById(orderId);
            if (!order) return;

            const clientId = order.clientId;

            // Get or create analytics document
            let analytics = await ClientAnalytics.findOne({ clientId });
            if (!analytics) {
                analytics = new ClientAnalytics({ clientId });
            }

            // Update lifetime stats
            await this.updateLifetimeStats(analytics, clientId);

            // Update daily/weekly/monthly stats
            await this.updatePeriodStats(analytics, order);

            // Update category breakdown
            await this.updateCategoryStats(analytics, order);

            // Update geographic stats
            await this.updateGeographicStats(analytics, clientId);

            // Update payment stats
            await this.updatePaymentStats(analytics, clientId);

            // Update patterns
            await this.updatePatterns(analytics, clientId);

            // Update trends
            await this.updateTrends(analytics);

            // Check for achievements
            await this.checkAchievements(analytics);

            await analytics.save();
            console.log(`✅ Client analytics updated for ${clientId}`);

        } catch (error) {
            console.error('Error updating client analytics:', error);
        }
    }

    /**
     * Update lifetime statistics
     */
    static async updateLifetimeStats(analytics, clientId) {
        const { Order } = await getOrderModels();

        const stats = await Order.aggregate([
            { $match: { clientId: new mongoose.Types.ObjectId(clientId) } },
            {
                $group: {
                    _id: null,
                    totalOrders: { $sum: 1 },
                    completedOrders: {
                        $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] }
                    },
                    cancelledOrders: {
                        $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] }
                    },
                    totalSpent: { $sum: '$pricing.totalAmount' },
                    totalDistance: { $sum: '$driverAssignment.distance.total' },
                    firstOrder: { $min: '$createdAt' },
                    lastOrder: { $max: '$createdAt' }
                }
            }
        ]);

        if (stats.length > 0) {
            const data = stats[0];
            analytics.lifetime = {
                totalOrders: data.totalOrders || 0,
                completedOrders: data.completedOrders || 0,
                cancelledOrders: data.cancelledOrders || 0,
                totalSpent: data.totalSpent || 0,
                totalDistance: data.totalDistance || 0,
                averageOrderValue: data.totalOrders > 0
                    ? data.totalSpent / data.totalOrders
                    : 0,
                firstOrderAt: data.firstOrder,
                lastOrderAt: data.lastOrder
            };

            // Update average rating given
            const ratingStats = await Order.aggregate([
                {
                    $match: {
                        clientId: new mongoose.Types.ObjectId(clientId),
                        'rating.clientRating.stars': { $exists: true }
                    }
                },
                {
                    $group: {
                        _id: null,
                        avgRating: { $avg: '$rating.clientRating.stars' },
                        count: { $sum: 1 }
                    }
                }
            ]);

            if (ratingStats.length > 0) {
                analytics.lifetime.averageRating = ratingStats[0].avgRating;
                analytics.lifetime.totalRatingsGiven = ratingStats[0].count;
            }
        }
    }

    /**
     * Update daily/weekly/monthly period stats
     */
    static async updatePeriodStats(analytics, order) {
        const { Order } = await getOrderModels();
        const clientId = order.clientId;

        // Update Daily Stats (last 30 days)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const dailyStats = await Order.aggregate([
            {
                $match: {
                    clientId: new mongoose.Types.ObjectId(clientId),
                    createdAt: { $gte: thirtyDaysAgo }
                }
            },
            {
                $group: {
                    _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                    total: { $sum: 1 },
                    completed: {
                        $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] }
                    },
                    cancelled: {
                        $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] }
                    },
                    gross: { $sum: '$pricing.totalAmount' },
                    distance: { $sum: '$driverAssignment.distance.total' },
                    categories: { $push: '$package.category' }
                }
            },
            { $sort: { _id: 1 } }
        ]);

        analytics.daily = dailyStats.map(day => ({
            period: new Date(day._id),
            orders: {
                total: day.total,
                completed: day.completed,
                cancelled: day.cancelled
            },
            spending: {
                gross: day.gross,
                fees: 0, // Calculate from payment data
                net: day.gross
            },
            distance: day.distance,
            categories: [...new Set(day.categories)]
        }));

        // Update Weekly Stats (last 12 weeks)
        const twelveWeeksAgo = new Date();
        twelveWeeksAgo.setDate(twelveWeeksAgo.getDate() - 84);

        const weeklyStats = await Order.aggregate([
            {
                $match: {
                    clientId: new mongoose.Types.ObjectId(clientId),
                    createdAt: { $gte: twelveWeeksAgo }
                }
            },
            {
                $group: {
                    _id: {
                        week: { $week: '$createdAt' },
                        year: { $year: '$createdAt' }
                    },
                    weekStart: { $min: '$createdAt' },
                    total: { $sum: 1 },
                    completed: {
                        $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] }
                    },
                    cancelled: {
                        $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] }
                    },
                    gross: { $sum: '$pricing.totalAmount' },
                    distance: { $sum: '$driverAssignment.distance.total' }
                }
            },
            { $sort: { weekStart: 1 } }
        ]);

        analytics.weekly = weeklyStats.map(week => {
            const weekEnd = new Date(week.weekStart);
            weekEnd.setDate(weekEnd.getDate() + 6);
            return {
                weekStart: week.weekStart,
                weekEnd,
                weekNumber: week._id.week,
                orders: {
                    total: week.total,
                    completed: week.completed,
                    cancelled: week.cancelled
                },
                spending: {
                    gross: week.gross,
                    fees: 0,
                    net: week.gross
                },
                distance: week.distance
            };
        });

        // Update Monthly Stats (last 12 months)
        const twelveMonthsAgo = new Date();
        twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

        const monthlyStats = await Order.aggregate([
            {
                $match: {
                    clientId: new mongoose.Types.ObjectId(clientId),
                    createdAt: { $gte: twelveMonthsAgo }
                }
            },
            {
                $group: {
                    _id: {
                        month: { $month: '$createdAt' },
                        year: { $year: '$createdAt' }
                    },
                    total: { $sum: 1 },
                    completed: {
                        $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] }
                    },
                    cancelled: {
                        $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] }
                    },
                    gross: { $sum: '$pricing.totalAmount' },
                    distance: { $sum: '$driverAssignment.distance.total' }
                }
            },
            { $sort: { '_id.year': 1, '_id.month': 1 } }
        ]);

        analytics.monthly = monthlyStats.map(month => ({
            period: new Date(month._id.year, month._id.month - 1, 1),
            month: month._id.month,
            year: month._id.year,
            orders: {
                total: month.total,
                completed: month.completed,
                cancelled: month.cancelled
            },
            spending: {
                gross: month.gross,
                fees: 0,
                net: month.gross
            },
            distance: month.distance
        }));
    }

    /**
     * Update category statistics
     */
    static async updateCategoryStats(analytics, order) {
        const { Order } = await getOrderModels();

        const categoryStats = await Order.aggregate([
            { $match: { clientId: order.clientId } },
            {
                $group: {
                    _id: '$package.category',
                    count: { $sum: 1 },
                    spent: { $sum: '$pricing.totalAmount' }
                }
            }
        ]);

        // Reset categories
        const categories = {};
        const categoryList = ['laptop', 'document', 'food', 'electronics', 'mobilePhone',
            'clothing', 'furniture', 'medicine', 'gifts', 'cake', 'books', 'others'];

        categoryList.forEach(cat => {
            categories[cat] = { count: 0, spent: 0 };
        });

        // Update with actual data
        categoryStats.forEach(cat => {
            const categoryName = cat._id || 'others';
            if (categories[categoryName]) {
                categories[categoryName] = {
                    count: cat.count,
                    spent: cat.spent
                };
            }
        });

        analytics.categories = categories;
    }

    /**
     * Update geographic statistics
     */
    static async updateGeographicStats(analytics, clientId) {
        const { Order } = await getOrderModels();

        // Top pickup areas
        const pickupAreas = await Order.aggregate([
            { $match: { clientId: new mongoose.Types.ObjectId(clientId) } },
            {
                $group: {
                    _id: {
                        state: '$location.pickUp.state',
                        lga: '$location.pickUp.lga'
                    },
                    orderCount: { $sum: 1 },
                    totalSpent: { $sum: '$pricing.totalAmount' }
                }
            },
            { $sort: { orderCount: -1 } },
            { $limit: 5 }
        ]);

        analytics.geographic.topPickupAreas = pickupAreas.map(area => ({
            state: area._id.state,
            lga: area._id.lga,
            orderCount: area.orderCount,
            totalSpent: area.totalSpent
        }));

        // Top dropoff areas
        const dropoffAreas = await Order.aggregate([
            { $match: { clientId: new mongoose.Types.ObjectId(clientId) } },
            {
                $group: {
                    _id: {
                        state: '$location.dropOff.state',
                        lga: '$location.dropOff.lga'
                    },
                    orderCount: { $sum: 1 },
                    totalSpent: { $sum: '$pricing.totalAmount' }
                }
            },
            { $sort: { orderCount: -1 } },
            { $limit: 5 }
        ]);

        analytics.geographic.topDropoffAreas = dropoffAreas.map(area => ({
            state: area._id.state,
            lga: area._id.lga,
            orderCount: area.orderCount,
            totalSpent: area.totalSpent
        }));

        // Average distance
        const avgDistance = await Order.aggregate([
            { $match: { clientId: new mongoose.Types.ObjectId(clientId) } },
            {
                $group: {
                    _id: null,
                    avgDistance: { $avg: '$driverAssignment.distance.total' }
                }
            }
        ]);

        if (avgDistance.length > 0) {
            analytics.geographic.averageDistance = avgDistance[0].avgDistance;
        }
    }

    /**
     * Update payment statistics
     */
    static async updatePaymentStats(analytics, clientId) {
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
        analytics.payments.paymentMethods = {
            paystack: { count: 0, amount: 0 },
            wallet: { count: 0, amount: 0 },
            combined: { count: 0, amount: 0 }
        };

        let totalPaid = 0;
        let totalFees = 0;

        paymentStats.forEach(stat => {
            const method = stat._id || 'paystack';
            if (analytics.payments.paymentMethods[method]) {
                analytics.payments.paymentMethods[method] = {
                    count: stat.count,
                    amount: stat.totalPaid
                };
            }
            totalPaid += stat.totalPaid;
            totalFees += stat.totalFees;
        });

        analytics.payments.totalPaid = totalPaid;
        analytics.payments.totalFees = totalFees;

        // Get wallet stats
        const wallet = await ClientWallet.findOne({ clientId });
        if (wallet) {
            analytics.payments.wallet = {
                totalDeposited: wallet.lifetime.totalDeposited,
                totalUsed: wallet.lifetime.totalSpent,
                currentBalance: wallet.balance
            };
        }
    }

    /**
     * Update ordering patterns
     */
    static async updatePatterns(analytics, clientId) {
        const { Order } = await getOrderModels();

        const orders = await Order.find({ clientId }).select('createdAt').lean();

        if (orders.length === 0) return;

        // Find most active day and hour
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

        analytics.patterns = {
            mostActiveDay,
            mostActiveHour: parseInt(mostActiveHour),
            averageOrdersPerWeek: analytics.lifetime.totalOrders /
                (analytics.weekly.length || 1),
            peakOrderingTime: {
                dayOfWeek: mostActiveDay,
                hourOfDay: parseInt(mostActiveHour)
            }
        };
    }

    /**
     * Update trends
     */
    static async updateTrends(analytics) {
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
    static async checkAchievements(analytics) {
        const milestones = [];
        const existing = analytics.achievements?.milestones || [];
        const existingTypes = new Set(existing.map(m => m.type));

        // First order
        if (analytics.lifetime.totalOrders >= 1 && !existingTypes.has('first_order')) {
            milestones.push({
                type: 'first_order',
                achievedAt: analytics.lifetime.firstOrderAt,
                badge: '🎉',
                description: 'First Order Placed'
            });
        }

        // Order milestones
        const orderMilestones = [
            { count: 10, badge: '📦', desc: '10 Orders' },
            { count: 50, badge: '🚀', desc: '50 Orders' },
            { count: 100, badge: '💫', desc: '100 Orders' },
            { count: 500, badge: '⭐', desc: '500 Orders' }
        ];

        orderMilestones.forEach(({ count, badge, desc }) => {
            const type = `orders_${count}`;
            if (analytics.lifetime.totalOrders >= count && !existingTypes.has(type)) {
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
            { amount: 10000, badge: '🌟', desc: 'Spent ₦10K' },
            { amount: 50000, badge: '⚜️', desc: 'Spent ₦50K' },
            { amount: 500000, badge: '💎', desc: 'Spent ₦500k' },
            { amount: 1000000, badge: '👑', desc: 'Spent ₦1M' }
        ];

        spendingMilestones.forEach(({ amount, badge, desc }) => {
            const type = `spent_${amount}`;
            if (analytics.lifetime.totalSpent >= amount && !existingTypes.has(type)) {
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
}

export default ClientAnalyticsUpdater;
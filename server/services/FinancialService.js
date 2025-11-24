// /services/FinancialService.js
import getFinancialModels from '../models/Finance/FinancialTransactions';
import getOrderModels from '../models/Order';

/**
 * Complete Financial Transaction Service
 * Handles all money movements in the system
 */
class FinancialService {

    /**
     * FLOW 1: Process Client Payment for Order
     * Handles: Paystack payment + optional wallet usage
     */
    static async processOrderPayment(data) {
        const {
            orderId,
            clientId,
            grossAmount,      // What client paid (including Paystack fees)
            paystackFee,      // Paystack's cut
            paystackRef,      // Paystack reference
            walletUsed = 0,   // Amount from wallet
            metadata = {}
        } = data;

        try {
            const {
                FinancialTransaction,
                ClientWallet
            } = await getFinancialModels();

            const { Order } = await getOrderModels();

            // Get order with pricing breakdown
            const order = await Order.findById(orderId);
            if (!order) {
                throw new Error('Order not found');
            }

            // Calculate net amount
            const netAmount = grossAmount - paystackFee;
            const totalOrderValue = netAmount + walletUsed;

            const pricingBreakdown = order.pricing.pricingBreakdown;
            const revenueDistribution = pricingBreakdown.revenueDistribution;

            // 1. Record the payment transaction
            const paymentTransaction = await FinancialTransaction.recordClientPayment({
                orderId,
                clientId,
                grossAmount,
                paystackFee,
                paystackRef,
                walletUsed,
                walletBalanceBefore: metadata.walletBalanceBefore || 0
            });

            // 2. If wallet was used, deduct from wallet
            if (walletUsed > 0) {
                const wallet = await ClientWallet.getOrCreateWallet(clientId);
                await wallet.deduct(walletUsed, paymentTransaction._id);
            }

            // 3. Update order with payment info
            await Order.findByIdAndUpdate(orderId, {
                'payment.status': 'paid',
                'payment.transactionId': paymentTransaction._id.toString(),
                'payment.paidAt': new Date(),
                'payment.paystackData': {
                    reference: paystackRef,
                    amount: grossAmount,
                    fees: paystackFee,
                    walletUsed
                },
                'pricing.financialReferences.paymentTransactionId': paymentTransaction._id
            });

            // This creates the liability records
            const { FinancialTransaction: FT } = await getFinancialModels();

            const driverEarningTransaction = await FT.recordDriverEarning({
                orderId,
                driverId: null, // Will be set when driver is assigned
                amount: revenueDistribution.driverShare
            });

            const platformRevenueTransaction = await FT.recordPlatformRevenue({
                orderId,
                amount: revenueDistribution.platformShare
            });

            // 5. Update order with all financial references
            await Order.findByIdAndUpdate(orderId, {
                'pricing.financialReferences.driverEarningTransactionId': driverEarningTransaction._id,
                'pricing.financialReferences.platformRevenueTransactionId': platformRevenueTransaction._id
            });


            return {
                success: true,
                transaction: paymentTransaction,
                totalPaid: totalOrderValue
            };

        } catch (error) {
            console.error('Error processing order payment:', error);
            throw error;
        }
    }

    /**
     * FLOW 2: Distribute Revenue After Delivery Completion
     * Splits: 70% to driver, 30% to platform
     */
    static async distributeOrderRevenue(orderId) {
        try {
            const {
                FinancialTransaction,
                DriverEarnings
            } = await getFinancialModels();

            const { Order } = await getOrderModels();

            // Get order details
            const order = await Order.findById(orderId);
            if (!order) {
                throw new Error('Order not found');
            }

            if (order.status !== 'delivered') {
                throw new Error('Order must be delivered before revenue distribution');
            }

            const driverId = order.driverAssignment?.driverId;
            if (!driverId) {
                throw new Error('No driver assigned to order');
            }
            const driverEarningTransactionId = order.pricing.financialReferences.driverEarningTransactionId;
            const platformRevenueTransactionId = order.pricing.financialReferences.platformRevenueTransactionId;

            if (!driverEarningTransactionId || !platformRevenueTransactionId) {
                throw new Error('Financial transactions not found for this order');
            }

            // Update driver ID in the earning transaction
            await FinancialTransaction.findByIdAndUpdate(driverEarningTransactionId, {
                driverId,
                status: 'completed',
                processedAt: new Date()
            });

            // Update driver earnings WITH PAGINATION
            const driverEarnings = await this.getOrCreateDriverEarnings(driverId);
            const driverShare = order.pricing.pricingBreakdown.revenueDistribution.driverShare;

            // Use the new pagination method
            await driverEarnings.addEarningWithPagination(driverShare, orderId, driverEarningTransactionId);

            return {
                success: true,
                distribution: order.pricing.pricingBreakdown.revenueDistribution,
                transactions: {
                    driver: driverEarningTransactionId,
                    platform: platformRevenueTransactionId
                }
            };

        } catch (error) {
            console.error('Error distributing revenue:', error);
            throw error;
        }
    }

    /**
     * FLOW 3: Process Driver Payout Request
     * Driver withdraws earnings to bank account
     */
    static async processDriverPayout(data) {
        const {
            driverId,
            requestedAmount,
            bankDetails
        } = data;

        try {
            const {
                FinancialTransaction,
                DriverEarnings
            } = await getFinancialModels();

            // 1. Check driver has sufficient balance
            const driverEarnings = await DriverEarnings.findOne({ driverId });
            if (!driverEarnings) {
                throw new Error('Driver earnings not found');
            }

            if (driverEarnings.availableBalance < requestedAmount) {
                throw new Error('Insufficient balance');
            }

            // 2. Calculate Paystack transfer fee (₦10 + 0.5%)
            const transferFee = Math.round(10 + (requestedAmount * 0.005));
            const netAmount = requestedAmount - transferFee;

            // 3. Call Paystack Transfer API
            const paystackTransfer = await this.initiatePaystackTransfer({
                amount: netAmount,
                recipient: bankDetails,
                reason: `Driver payout for ${driverId}`
            });

            if (!paystackTransfer.success) {
                throw new Error('Paystack transfer failed');
            }

            // 4. Record payout transaction
            const payoutTransaction = await FinancialTransaction.recordDriverPayout({
                driverId,
                requestedAmount,
                transferFee,
                bankDetails,
                paystackTransferRef: paystackTransfer.reference
            });

            // 5. Update driver earnings with payout info
            await driverEarnings.recordPayout(
                requestedAmount,
                netAmount,
                payoutTransaction._id,
            );

            return {
                success: true,
                payout: {
                    requested: requestedAmount,
                    fee: transferFee,
                    net: netAmount,
                    reference: paystackTransfer.reference
                },
                transaction: payoutTransaction._id
            };

        } catch (error) {
            console.error('Error processing driver payout:', error);
            throw error;
        }
    }

    /**
     * FLOW 4: Process Wallet Top-up
     * Client deposits money into wallet
     */
    static async processWalletTopup(data) {
        const {
            clientId,
            grossAmount,
            paystackFee,
            paystackRef
        } = data;

        try {
            const {
                FinancialTransaction,
                ClientWallet
            } = await getFinancialModels();

            const netAmount = grossAmount - paystackFee;

            // 1. Record wallet deposit transaction
            const transaction = new FinancialTransaction({
                transactionType: 'wallet_deposit',
                clientId,
                amount: {
                    gross: grossAmount,
                    fees: paystackFee,
                    net: netAmount
                },
                gateway: {
                    provider: 'paystack',
                    reference: paystackRef
                },
                status: 'completed',
                processedAt: new Date(),
                processedBy: 'system'
            });

            await transaction.save();

            // 2. Credit wallet
            const wallet = await ClientWallet.getOrCreateWallet(clientId);
            await wallet.deposit(netAmount, transaction._id);

            return {
                success: true,
                wallet: {
                    balance: wallet.balance,
                    deposited: netAmount
                },
                transaction: transaction._id
            };

        } catch (error) {
            console.error('Error processing wallet top-up:', error);
            throw error;
        }
    }

    /**
     * FLOW 5: Process Refund
     * Return money to client
     */
    static async processRefund(data) {
        const {
            orderId,
            clientId,
            refundAmount,
            reason,
            approvedBy
        } = data;

        try {
            const {
                FinancialTransaction,
                ClientWallet,
                DriverEarnings
            } = await getFinancialModels();

            const { Order } = await getOrderModels();

            // Get order
            const order = await Order.findById(orderId);
            if (!order) {
                throw new Error('Order not found');
            }

            // Calculate refund split
            const driverRefund = Math.round(refundAmount * 0.70);
            const platformRefund = refundAmount - driverRefund;

            // 1. Create refund transaction
            const refundTransaction = new FinancialTransaction({
                transactionType: 'refund',
                orderId,
                clientId,
                amount: {
                    gross: refundAmount,
                    fees: 0,
                    net: refundAmount
                },
                refund: {
                    reason,
                    originalTransactionId: order.payment?.transactionId,
                    approvedBy,
                    processedAt: new Date()
                },
                status: 'completed',
                processedBy: 'admin'
            });

            await refundTransaction.save();

            // 2. Credit client wallet
            const wallet = await ClientWallet.getOrCreateWallet(clientId);
            await wallet.deposit(refundAmount, refundTransaction._id);
            wallet.lifetime.totalRefunded += refundAmount;
            await wallet.save();

            // 3. Deduct from driver earnings (if driver assigned)
            if (order.driverAssignment?.driverId) {
                const driverEarnings = await DriverEarnings.findOne({
                    driverId: order.driverAssignment.driverId
                });

                if (driverEarnings) {
                    driverEarnings.availableBalance -= driverRefund;
                    driverEarnings.earnings.available -= driverRefund;
                    await driverEarnings.save();
                }
            }

            // 4. Update order
            await Order.findByIdAndUpdate(orderId, {
                'refund': {
                    amount: refundAmount,
                    reason,
                    transactionId: refundTransaction._id,
                    processedAt: new Date(),
                    approvedBy
                },
                status: 'refunded'
            });

            return {
                success: true,
                refund: {
                    amount: refundAmount,
                    clientReceived: refundAmount,
                    driverDeducted: driverRefund,
                    platformDeducted: platformRefund
                },
                transaction: refundTransaction._id
            };

        } catch (error) {
            console.error('Error processing refund:', error);
            throw error;
        }
    }

    /**
     * NEW: Get or create driver earnings with pagination initialization
     */
    static async getOrCreateDriverEarnings(driverId) {
        try {
            const { DriverEarnings } = await getFinancialModels();

            let earnings = await DriverEarnings.findOne({ driverId });

            if (!earnings) {
                earnings = new DriverEarnings({
                    driverId,
                    availableBalance: 0,
                    earningsPagination: {
                        currentPage: 1,
                        totalPages: 1,
                        totalEarnings: 0,
                        pageSize: 500,
                        nextPageId: 2
                    },
                    earningsPages: [{
                        pageId: 1,
                        pageNumber: 1,
                        earnings: [],
                        dateRange: {
                            start: new Date(),
                            end: new Date()
                        },
                        count: 0,
                        isFull: false,
                        createdAt: new Date()
                    }]
                });
                await earnings.save();
            }

            return earnings;
        } catch (error) {
            console.error('Error getting/creating driver earnings:', error);
            throw error;
        }
    }

    /**
     * NEW: Find which earnings to mark as withdrawn for payout
     */
    static async findEarningsForPayout(driverEarnings, payoutAmount) {
        const earningsUsed = [];
        let amountRemaining = payoutAmount;

        // Search through pages (oldest first for FIFO)
        for (const page of driverEarnings.earningsPages) {
            for (const earning of page.earnings) {
                if (earning.status === 'available' && amountRemaining > 0) {
                    earningsUsed.push(earning.transactionId);
                    amountRemaining -= earning.amount;

                    if (amountRemaining <= 0) break;
                }
            }
            if (amountRemaining <= 0) break;
        }

        return earningsUsed;
    }

    /**
     * NEW: Get driver earnings with pagination support
     */
    static async getDriverEarningsWithPagination(driverId, page = 1, limit = 50) {
        try {
            const driverEarnings = await this.getOrCreateDriverEarnings(driverId);

            const targetPage = driverEarnings.getEarningsPage(page);
            if (!targetPage) {
                return {
                    success: true,
                    earnings: [],
                    pagination: {
                        currentPage: page,
                        totalPages: driverEarnings.earningsPagination.totalPages,
                        totalEarnings: driverEarnings.earningsPagination.totalEarnings,
                        hasNext: page < driverEarnings.earningsPagination.totalPages,
                        hasPrev: page > 1
                    }
                };
            }

            const startIndex = (page - 1) * limit;
            const pageEarnings = targetPage.earnings.slice(startIndex, startIndex + limit);

            return {
                success: true,
                earnings: pageEarnings,
                pagination: {
                    currentPage: page,
                    totalPages: driverEarnings.earningsPagination.totalPages,
                    totalEarnings: driverEarnings.earningsPagination.totalEarnings,
                    pageSize: driverEarnings.earningsPagination.pageSize,
                    hasNext: page < driverEarnings.earningsPagination.totalPages,
                    hasPrev: page > 1
                }
            };
        } catch (error) {
            console.error('Error getting driver earnings with pagination:', error);
            throw error;
        }
    }

    /**
     * Helper: Initiate Paystack Transfer (Mock for now)
     * In production, integrate with Paystack Transfer API
     */
    static async initiatePaystackTransfer(data) {
        // TODO: Integrate with actual Paystack Transfer API
        // For now, return mock success
        return {
            success: true,
            reference: `TRF_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            status: 'success',
            message: 'Transfer initiated successfully'
        };
    }

    /**
     * Analytics: Get driver financial summary (UPDATED for pagination)
     */
    static async getDriverFinancialSummary(driverId, period = 'all') {
        try {
            const {
                FinancialTransaction
            } = await getFinancialModels();

            const driverEarnings = await this.getOrCreateDriverEarnings(driverId);

            // Build date filter
            let dateFilter = {};
            if (period !== 'all') {
                const now = new Date();
                if (period === 'month') {
                    dateFilter = {
                        createdAt: {
                            $gte: new Date(now.getFullYear(), now.getMonth(), 1)
                        }
                    };
                } else if (period === 'week') {
                    const weekAgo = new Date(now.setDate(now.getDate() - 7));
                    dateFilter = { createdAt: { $gte: weekAgo } };
                }
            }

            // Get transactions
            const transactions = await FinancialTransaction.find({
                driverId,
                transactionType: { $in: ['driver_earning', 'driver_payout'] },
                ...dateFilter
            }).sort({ createdAt: -1 });

            return {
                success: true,
                summary: {
                    availableBalance: driverEarnings.availableBalance,
                    lifetime: driverEarnings.lifetime,
                    earnings: driverEarnings.earnings,
                    recentEarnings: driverEarnings.recentEarnings, // Last 50
                    recentPayouts: driverEarnings.recentPayouts,
                    pagination: driverEarnings.earningsPagination
                },
                transactions
            };

        } catch (error) {
            console.error('Error getting driver financial summary:', error);
            throw error;
        }
    }

    /**
     * Analytics: Get client financial summary
     */
    static async getClientFinancialSummary(clientId) {
        try {
            const {
                FinancialTransaction,
                ClientWallet
            } = await getFinancialModels();

            const wallet = await ClientWallet.findOne({ clientId });

            const transactions = await FinancialTransaction.find({
                clientId,
                transactionType: { $in: ['client_payment', 'wallet_deposit', 'wallet_deduction', 'refund'] }
            }).sort({ createdAt: -1 }).limit(50);

            return {
                success: true,
                wallet: {
                    balance: wallet?.balance || 0,
                    lifetime: wallet?.lifetime || {},
                    recentTransactions: wallet?.recentTransactions || []
                },
                transactions
            };

        } catch (error) {
            console.error('Error getting client financial summary:', error);
            throw error;
        }
    }

}

export default FinancialService;
// services/FinancialService.js - ENHANCED VERSION
import axios from 'axios';
import getFinancialModels from '../models/Finance/FinancialTransactions.js';
import getOrderModels from '../models/Order';
import ReferenceGenerator from '../utils/ReferenceGenerator';
import getModels from "../models/AAng/AAngLogistics";

/**
 * Complete Financial Transaction Service
 * Enhanced with pagination support and comprehensive payout handling
 */
class FinancialService {

    /**
     * Get or create driver earnings with pagination initialization
     */
    static async getOrCreateDriverEarnings(driverId) {
        try {
            const {DriverEarnings} = await getFinancialModels();

            let earnings = await DriverEarnings.findOne({driverId});

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
     * Get driver earnings with pagination support
     */
    static async getDriverEarningsWithPagination(driverId, page = 1, limit = 50, filters = {}) {
        try {
            const driverEarnings = await this.getOrCreateDriverEarnings(driverId);

            // Apply filters if provided
            let allEarnings = [];

            if (Object.keys(filters).length > 0) {
                // Search through all pages with filters
                allEarnings = driverEarnings.searchEarnings(filters);
            } else {
                // Get earnings from specific page
                const targetPage = driverEarnings.getEarningsPage(page);
                if (targetPage) {
                    allEarnings = targetPage.earnings;
                }
            }

            // Paginate results
            const startIndex = (page - 1) * limit;
            const paginatedEarnings = allEarnings.slice(startIndex, startIndex + limit);

            return {
                success: true,
                earnings: paginatedEarnings,
                pagination: {
                    currentPage: page,
                    totalPages: Math.ceil(allEarnings.length / limit),
                    totalEarnings: driverEarnings.earningsPagination.totalEarnings,
                    pageSize: limit,
                    hasNext: startIndex + limit < allEarnings.length,
                    hasPrev: page > 1
                }
            };
        } catch (error) {
            console.error('Error getting driver earnings with pagination:', error);
            throw error;
        }
    }

    /**
     * Get comprehensive driver financial summary
     */
    static async getDriverFinancialSummary(driverId, period = 'all') {
        try {
            const {FinancialTransaction} = await getFinancialModels();
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
                    dateFilter = {createdAt: {$gte: weekAgo}};
                } else if (period === 'year') {
                    dateFilter = {
                        createdAt: {
                            $gte: new Date(now.getFullYear(), 0, 1)
                        }
                    };
                }
            }

            // Get transactions for period
            const transactions = await FinancialTransaction.find({
                driverId,
                transactionType: {$in: ['driver_earning', 'driver_payout']},
                ...dateFilter
            }).sort({createdAt: -1});

            // Calculate period-specific metrics
            const periodEarnings = transactions
                .filter(t => t.transactionType === 'driver_earning')
                .reduce((sum, t) => sum + t.amount.net, 0);

            const periodPayouts = transactions
                .filter(t => t.transactionType === 'driver_payout' && t.status === 'completed')
                .reduce((sum, t) => sum + t.amount.net, 0);

            return {
                success: true,
                summary: {
                    // Current balances
                    availableBalance: driverEarnings.availableBalance,
                    pendingEarnings: driverEarnings.earnings.pending,

                    // Lifetime statistics
                    totalEarnings: driverEarnings.lifetime.totalEarned,
                    totalWithdrawn: driverEarnings.lifetime.totalWithdrawn,
                    totalDeliveries: driverEarnings.lifetime.deliveryCount,
                    averageEarning: driverEarnings.lifetime.averagePerDelivery,

                    // Period-specific
                    periodEarnings,
                    periodPayouts,

                    // Bank details
                    bankDetails: driverEarnings.bankDetails,

                    // Recent activity
                    recentEarnings: driverEarnings.recentEarnings.slice(0, 10),
                    recentPayouts: driverEarnings.recentPayouts.slice(0, 10)
                },
                transactions: transactions.slice(0, 20) // Last 20 for context
            };
        } catch (error) {
            console.error('Error getting driver financial summary:', error);
            throw error;
        }
    }

    static async getDriverFinancialTransactions(driverId, page = 1, limit = 50, filters = {}) {
        try {
            const { FinancialTransaction } = await getFinancialModels();

            // Build query
            let query = { driverId };

            // Filter by transaction type
            if (filters.type && filters.type !== 'all') {
                if (filters.type === 'earnings') {
                    query.transactionType = 'driver_earning';
                } else if (filters.type === 'withdrawals') {
                    query.transactionType = 'driver_payout';
                }
            } else {
                // Default to show both
                query.transactionType = { $in: ['driver_earning', 'driver_payout'] };
            }

            // Filter by status
            if (filters.status && filters.status !== 'all') {
                query.status = filters.status;
            }

            // Calculate pagination
            const skip = (page - 1) * limit;
            const total = await FinancialTransaction.countDocuments(query);

            // Get transactions
            const transactions = await FinancialTransaction.find(query)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean();

            // Calculate stats
            const earningsAggregate = await FinancialTransaction.aggregate([
                { $match: { driverId, transactionType: 'driver_earning', status: 'completed' } },
                { $group: { _id: null, total: { $sum: '$amount.net' }, count: { $sum: 1 } } }
            ]);

            const withdrawalsAggregate = await FinancialTransaction.aggregate([
                { $match: { driverId, transactionType: 'driver_payout', status: 'completed' } },
                { $group: { _id: null, total: { $sum: '$amount.net' }, count: { $sum: 1 } } }
            ]);

            const earningsStats = earningsAggregate[0] || { total: 0, count: 0 };
            const withdrawalsStats = withdrawalsAggregate[0] || { total: 0, count: 0 };

            return {
                success: true,
                transactions: transactions,
                pagination: {
                    currentPage: page,
                    totalPages: Math.ceil(total / limit),
                    totalItems: total,
                    pageSize: limit,
                    hasNext: skip + limit < total,
                    hasPrev: page > 1
                },
                stats: {
                    totalTransactions: total,
                    totalEarnings: earningsStats.total,
                    totalWithdrawals: withdrawalsStats.total,
                    earningsCount: earningsStats.count,
                    withdrawalsCount: withdrawalsStats.count
                }
            };

        } catch (error) {
            console.error('Error getting driver financial transactions:', error);
            throw error;
        }
    }

    /**
     * Process driver payout with unique reference and webhook support
     */
    static async processDriverPayout(data) {
        const { driverId, requestedAmount, bankDetails } = data;

        try {
            const { FinancialTransaction, DriverEarnings } = await getFinancialModels();

            // 1. Validate driver has sufficient balance
            const driverEarnings = await DriverEarnings.findOne({ driverId });
            if (!driverEarnings) {
                throw new Error('Driver earnings not found');
            }

            if (driverEarnings.availableBalance < requestedAmount) {
                throw new Error(`Insufficient balance. Available: ₦${driverEarnings.availableBalance.toLocaleString()}`);
            }

            // 2. Calculate fees using new tiered structure
            const transferFee = FinancialService.calculateTransferFee(requestedAmount);
            const netAmount = requestedAmount - transferFee;

            // 3. Generate unique transfer reference
            const transferReference = ReferenceGenerator.generateTransferReference();

            // 4. Check for duplicate reference (safety check)
            const existingTransaction = await FinancialTransaction.findOne({
                'gateway.reference': transferReference
            });

            if (existingTransaction) {
                throw new Error('Duplicate transfer reference detected. Please retry.');
            }

            // 5. Create recipient on Paystack (if not exists)
            let recipientCode = bankDetails.recipientCode;

            if (!recipientCode) {
                try {
                    const recipientResponse = await axios.post(
                        'https://api.paystack.co/transferrecipient',
                        {
                            type: 'nuban',
                            name: bankDetails.accountName,
                            account_number: bankDetails.accountNumber,
                            bank_code: bankDetails.bankCode,
                            currency: 'NGN'
                        },
                        {
                            headers: {
                                Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
                                'Content-Type': 'application/json'
                            }
                        }
                    );

                    if (!recipientResponse.data.status) {
                        throw new Error('Failed to create transfer recipient: ' + recipientResponse.data.message);
                    }

                    recipientCode = recipientResponse.data.data.recipient_code;

                    // Update bank details with recipient code for future use
                    await FinancialService.updateBankDetailsWithRecipientCode(driverId, bankDetails.accountNumber, recipientCode);
                } catch (paystackError) {
                    console.error('Paystack recipient creation error:', paystackError.response?.data || paystackError.message);
                    throw new Error('Failed to create bank transfer recipient');
                }
            }

            // 6. Initiate transfer on Paystack with our reference
            const transferResponse = await axios.post(
                'https://api.paystack.co/transfer',
                {
                    source: 'balance',
                    amount: netAmount * 100, // Convert to kobo
                    recipient: recipientCode,
                    reference: transferReference, // Use our generated reference
                    reason: `Driver payout for ${driverId}`
                },
                {
                    headers: {
                        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            console.log('Paystack transfer response:', transferResponse.data);

            if (!transferResponse.data.status) {
                throw new Error(transferResponse.data.message || 'Transfer initiation failed');
            }

            // Paystack will return our reference
            const paystackResponse = transferResponse.data.data;

            // 7. Record payout transaction
            const payoutTransaction = new FinancialTransaction({
                transactionType: 'driver_payout',
                driverId,
                amount: {
                    gross: requestedAmount,
                    fees: transferFee,
                    net: netAmount,
                    currency: 'NGN'
                },
                payout: {
                    requestedAmount,
                    transferFee,
                    netAmount,
                    bankDetails: {
                        accountName: bankDetails.accountName,
                        bankName: bankDetails.bankName,
                        bankCode: bankDetails.bankCode,
                        accountNumber: bankDetails.accountNumber,
                        recipientCode
                    },
                    paystackTransferRef: transferReference,
                    paystackTransferCode: paystackResponse.transfer_code,
                    transferStatus: 'pending'
                },
                gateway: {
                    provider: 'paystack',
                    reference: transferReference,
                    metadata: {
                        transfer_code: paystackResponse.transfer_code,
                        initiated_at: new Date()
                    }
                },
                status: 'pending',
                processedBy: 'system'
            });

            await payoutTransaction.save();

            // 8. Update driver earnings (deduct immediately but mark as pending)
            driverEarnings.availableBalance -= requestedAmount;
            driverEarnings.earnings.available -= requestedAmount;
            driverEarnings.earnings.pending += requestedAmount; // Track as pending
            driverEarnings.lifetime.lastWithdrawalAt = new Date();

            // Add to recent payouts
            driverEarnings.recentPayouts.unshift({
                transactionId: payoutTransaction._id,
                amount: requestedAmount,
                netAmount: netAmount,
                status: 'pending',
                requestedAt: new Date()
            });

            // Keep only last 10 payouts
            if (driverEarnings.recentPayouts.length > 10) {
                driverEarnings.recentPayouts = driverEarnings.recentPayouts.slice(0, 10);
            }

            await driverEarnings.save();

            return {
                success: true,
                transaction: payoutTransaction._id,
                payout: {
                    requestedAmount,
                    transferFee,
                    netAmount,
                    reference: transferReference,
                    status: 'pending'
                }
            };

        } catch (error) {
            console.error('Error processing driver payout:', error);
            throw error;
        }
    }

    /**
     * Calculate transfer fee based on tiered structure
     */
    static calculateTransferFee(amount) {
        if (amount <= 5000) {
            return 10;
        } else if (amount <= 50000) {
            return 25;
        } else {
            return 50;
        }
    }

    /**
     * Update bank details with recipient code for future use
     */
    static async updateBankDetailsWithRecipientCode(driverId, accountNumber, recipientCode) {
        try {
            const {AAngBase} = await getModels();


            await AAngBase.updateOne(
                {
                    _id: driverId,
                    'verification.basicVerification.bankAccounts.accountNumber': accountNumber
                },
                {
                    $set: {
                        'verification.basicVerification.bankAccounts.$.recipientCode': recipientCode
                    }
                }
            );
        } catch (error) {
            console.error('Error updating recipient code:', error);
            // Don't throw - this is not critical
        }
    }

    /**
     * Handle transfer webhook - SUCCESS
     */
    static async handleTransferSuccess(webhookData) {
        try {
            const {FinancialTransaction, DriverEarnings} = await getFinancialModels();

            const reference = webhookData.reference || webhookData.data?.reference;
            const transferCode = webhookData.transfer_code || webhookData.data?.transfer_code;

            // Find the transaction
            const transaction = await FinancialTransaction.findOne({
                'gateway.reference': reference,
                transactionType: 'driver_payout'
            });

            if (!transaction) {
                console.error('Transaction not found for reference:', reference);
                return {success: false, message: 'Transaction not found'};
            }

            // Update transaction status
            transaction.status = 'completed';
            transaction.payout.transferStatus = 'success';
            transaction.processedAt = new Date();
            transaction.gateway.metadata.completed_at = webhookData.updatedAt || webhookData.data?.updatedAt || new Date();
            transaction.gateway.metadata.webhook_received_at = new Date();

            await transaction.save();

            // Update driver earnings
            const driverEarnings = await DriverEarnings.findOne({
                driverId: transaction.driverId
            });

            if (driverEarnings) {
                // Move from pending to withdrawn
                const amount = transaction.amount.gross;
                driverEarnings.earnings.pending -= amount;
                driverEarnings.earnings.withdrawn += amount;
                driverEarnings.lifetime.totalWithdrawn += amount;

                // Update payout status in recent payouts
                const recentPayout = driverEarnings.recentPayouts.find(
                    p => p.transactionId.toString() === transaction._id.toString()
                );
                if (recentPayout) {
                    recentPayout.status = 'completed';
                    recentPayout.processedAt = new Date();
                }

                await driverEarnings.save();
            }

            console.log(`Transfer successful: ${reference}`);
            return {success: true, message: 'Transfer completed successfully'};

        } catch (error) {
            console.error('Error handling transfer success:', error);
            return {success: false, message: error.message};
        }
    }

    /**
     * Handle transfer webhook - FAILED
     */
    static async handleTransferFailed(webhookData) {
        try {
            const {FinancialTransaction, DriverEarnings} = await getFinancialModels();

            const reference = webhookData.reference || webhookData.data?.reference;

            // Find the transaction
            const transaction = await FinancialTransaction.findOne({
                'gateway.reference': reference,
                transactionType: 'driver_payout'
            });

            if (!transaction) {
                console.error('Transaction not found for reference:', reference);
                return {success: false, message: 'Transaction not found'};
            }

            // Update transaction status
            transaction.status = 'failed';
            transaction.payout.transferStatus = 'failed';
            transaction.gateway.metadata.failed_at = webhookData.updatedAt || webhookData.data?.updatedAt || new Date();
            transaction.gateway.metadata.failure_reason = webhookData.failures || webhookData.data?.failures || 'Transfer failed';
            transaction.gateway.metadata.webhook_received_at = new Date();

            await transaction.save();

            // Reverse the deduction - refund driver
            const driverEarnings = await DriverEarnings.findOne({
                driverId: transaction.driverId
            });

            if (driverEarnings) {
                const amount = transaction.amount.gross;

                // Restore available balance
                driverEarnings.availableBalance += amount;
                driverEarnings.earnings.available += amount;
                driverEarnings.earnings.pending -= amount;

                // Update payout status in recent payouts
                const recentPayout = driverEarnings.recentPayouts.find(
                    p => p.transactionId.toString() === transaction._id.toString()
                );
                if (recentPayout) {
                    recentPayout.status = 'failed';
                    recentPayout.processedAt = new Date();
                }

                await driverEarnings.save();
            }

            console.log(`Transfer failed and reversed: ${reference}`);
            return {success: true, message: 'Transfer failed, funds restored'};

        } catch (error) {
            console.error('Error handling transfer failure:', error);
            return {success: false, message: error.message};
        }
    }

    /**
     * Handle transfer webhook - REVERSED
     */
    static async handleTransferReversed(webhookData) {
        // Same logic as failed
        return await FinancialService.handleTransferFailed(webhookData);
    }


    /**
     * Find earnings to mark as withdrawn (FIFO)
     */
    static async findEarningsForPayout(driverEarnings, payoutAmount) {
        const earningsUsed = [];
        let amountRemaining = payoutAmount;

        // Search through pages (oldest first for FIFO)
        for (const page of driverEarnings.earningsPages) {
            for (const earning of page.earnings) {
                if (earning.status === 'available' && amountRemaining > 0) {
                    earningsUsed.push(earning.transactionId.toString());
                    amountRemaining -= earning.amount;

                    if (amountRemaining <= 0) break;
                }
            }
            if (amountRemaining <= 0) break;
        }

        return earningsUsed;
    }

    /**
     * Distribute order revenue after delivery completion
     */
    static async distributeOrderRevenue(orderId) {
        try {
            const {FinancialTransaction} = await getFinancialModels();
            const {Order} = await getOrderModels();

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
            await driverEarnings.addEarningWithPagination(
                driverShare,
                orderId,
                driverEarningTransactionId
            );

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
     * Process order payment (from existing code)
     */
    static async processOrderPayment(data) {
        const {
            orderId,
            clientId,
            grossAmount,
            paystackFee,
            paystackRef,
            walletUsed = 0,
            metadata = {}
        } = data;

        try {
            const {FinancialTransaction, ClientWallet} = await getFinancialModels();
            const {Order} = await getOrderModels();

            const order = await Order.findById(orderId);
            if (!order) {
                throw new Error('Order not found');
            }

            const netAmount = grossAmount - paystackFee;
            const totalOrderValue = netAmount + walletUsed;
            const pricingBreakdown = order.pricing.pricingBreakdown;
            const revenueDistribution = pricingBreakdown.revenueDistribution;

            // 1. Record payment transaction
            const paymentTransaction = await FinancialTransaction.recordClientPayment({
                orderId,
                clientId,
                grossAmount,
                paystackFee,
                paystackRef,
                walletUsed,
                walletBalanceBefore: metadata.walletBalanceBefore || 0
            });

            // 2. Deduct from wallet if used
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

            // 4. Create liability records
            const {FinancialTransaction: FT} = await getFinancialModels();

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
     * Process wallet top-up
     */
    static async processWalletTopup(data) {
        const {clientId, grossAmount, paystackFee, paystackRef} = data;

        try {
            const {FinancialTransaction, ClientWallet} = await getFinancialModels();
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
     * Process refund
     */
    static async processRefund(data) {
        const {orderId, clientId, refundAmount, reason, approvedBy} = data;

        try {
            const {
                FinancialTransaction,
                ClientWallet,
                DriverEarnings
            } = await getFinancialModels();

            const {Order} = await getOrderModels();

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
     * Update payout transaction based on Paystack status
     * This is called when we manually verify with Paystack
     */
    static async updatePayoutFromPaystackStatus(transaction, paystackStatus, paystackData) {
        try {
            const { FinancialTransaction, DriverEarnings } = await getFinancialModels();

            console.log(`Updating transaction ${transaction._id} from Paystack status: ${paystackStatus}`);

            // Map Paystack status to our internal status
            let internalStatus;
            let shouldUpdateDriverEarnings = false;

            switch (paystackStatus) {
                case 'success':
                    internalStatus = 'completed';
                    shouldUpdateDriverEarnings = true;
                    break;
                case 'failed':
                    internalStatus = 'failed';
                    shouldUpdateDriverEarnings = true;
                    break;
                case 'reversed':
                    internalStatus = 'reversed';
                    shouldUpdateDriverEarnings = true;
                    break;
                case 'pending':
                case 'processing':
                case 'otp':
                case 'queued':
                    internalStatus = 'processing';
                    break;
                default:
                    console.warn(`Unknown Paystack status: ${paystackStatus}`);
                    internalStatus = 'processing';
            }

            // Only update if status has changed
            if (transaction.status !== internalStatus) {
                // Update transaction
                transaction.status = internalStatus;
                transaction.payout.transferStatus = paystackStatus;
                transaction.gateway.metadata = {
                    ...transaction.gateway.metadata,
                    last_verified_at: new Date(),
                    paystack_data: paystackData
                };

                if (internalStatus === 'completed') {
                    transaction.processedAt = new Date();
                }

                await transaction.save();

                // Update driver earnings if needed
                if (shouldUpdateDriverEarnings) {
                    const driverEarnings = await DriverEarnings.findOne({
                        driverId: transaction.driverId
                    });

                    if (driverEarnings) {
                        const amount = transaction.amount.gross;

                        if (internalStatus === 'completed') {
                            // Success - move from pending to withdrawn
                            driverEarnings.earnings.pending -= amount;
                            driverEarnings.earnings.withdrawn += amount;
                            driverEarnings.lifetime.totalWithdrawn += amount;

                            // Update in recent payouts
                            const recentPayout = driverEarnings.recentPayouts.find(
                                p => p.transactionId.toString() === transaction._id.toString()
                            );
                            if (recentPayout) {
                                recentPayout.status = 'completed';
                                recentPayout.processedAt = new Date();
                            }

                        } else if (internalStatus === 'failed' || internalStatus === 'reversed') {
                            // Failed/Reversed - restore available balance
                            driverEarnings.availableBalance += amount;
                            driverEarnings.earnings.available += amount;
                            driverEarnings.earnings.pending -= amount;

                            // Update in recent payouts
                            const recentPayout = driverEarnings.recentPayouts.find(
                                p => p.transactionId.toString() === transaction._id.toString()
                            );
                            if (recentPayout) {
                                recentPayout.status = internalStatus;
                                recentPayout.processedAt = new Date();
                            }
                        }

                        await driverEarnings.save();
                    }

                    // Send notification
                    // await NotificationService.notifyPayoutStatus(
                    //     transaction.driverId,
                    //     {
                    //         _id: transaction._id,
                    //         reference: transaction.gateway.reference,
                    //         netAmount: transaction.payout.netAmount,
                    //         requestedAmount: transaction.payout.requestedAmount
                    //     },
                    //     internalStatus
                    // );
                }

                console.log(`Transaction ${transaction._id} updated to ${internalStatus}`);
            } else {
                console.log(`Transaction ${transaction._id} status unchanged: ${internalStatus}`);
            }

            return { success: true, status: internalStatus };

        } catch (error) {
            console.error('Error updating payout from Paystack status:', error);
            throw error;
        }
    }
}

export default FinancialService;
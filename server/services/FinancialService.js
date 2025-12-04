// services/FinancialService.js - ENHANCED VERSION
import axios from 'axios';
import getFinancialModels from '../models/Finance/FinancialTransactions.js';
import getOrderModels from '../models/Order';
import ReferenceGenerator from '../utils/ReferenceGenerator';
import getModels from "../models/AAng/AAngLogistics";
import mongoose from "mongoose";

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
                { $group: { _id: null, total: { $sum: '$amount.gross' }, count: { $sum: 1 } } }
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
                    withdrawalsCount: withdrawalsStats.count,
                    availableBalance: earningsStats.total - withdrawalsStats.total
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

            // Create transaction record FIRST (before balance changes)
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
                        paystack_response: paystackResponse,
                        initiated_at: new Date()
                    }
                },
                status: 'pending',
                processedBy: 'system'
            });

            await payoutTransaction.save();

            const balanceBefore = driverEarnings.availableBalance;

            // Deduct from available (money is now locked)
            driverEarnings.availableBalance -= requestedAmount;

            // CRITICAL: Don't touch earnings.available yet
            // Only update when we know final outcome

            // Track this specific pending transfer
            driverEarnings.pendingTransfers.push({
                transactionId: payoutTransaction._id,
                paystackReference: transferReference,
                paystackTransferCode: paystackResponse.transfer_code,
                requestedAmount: requestedAmount,
                transferFee: transferFee,
                netAmount: netAmount,
                balanceBefore: balanceBefore, // Store for reconciliation
                balanceAfter: driverEarnings.availableBalance,
                status: 'pending',
                requestedAt: new Date(),
                paystackResponse: paystackResponse,
                bankDetails: {
                    accountName: bankDetails.accountName,
                    bankName: bankDetails.bankName,
                    accountNumber: bankDetails.accountNumber,
                    bankCode: bankDetails.bankCode,
                    recipientCode: recipientCode
                }
            });

            // Update lifetime stats
            driverEarnings.lifetime.lastWithdrawalAt = new Date();

            // Add to recent payouts
            driverEarnings.recentPayouts.unshift({
                transactionId: payoutTransaction._id,
                amount: requestedAmount,
                netAmount: netAmount,
                status: 'pending',
                requestedAt: new Date()
            });

            // Keep only last 10 recent payouts
            if (driverEarnings.recentPayouts.length > 50) {
                driverEarnings.recentPayouts = driverEarnings.recentPayouts.slice(0, 10);
            }

            await driverEarnings.save();

            // Commit transaction

            console.log('✅ Payout processed successfully:', {
                transactionId: payoutTransaction._id,
                reference: transferReference,
                amount: requestedAmount,
                balanceBefore,
                balanceAfter: driverEarnings.availableBalance
            });

            return {
                success: true,
                transaction: payoutTransaction._id,
                payout: {
                    requestedAmount,
                    transferFee,
                    netAmount,
                    reference: transferReference,
                    paystackStatus: paystackResponse.status,
                    status: 'pending',
                    balanceBefore,
                    balanceAfter: driverEarnings.availableBalance
                }
            };

        } catch (error) {
            console.log('❌ Error processing driver payout:', error);
            throw error;
        }
    }

    /**
     * Handle webhook SUCCESS - CORRECTED VERSION
     */
    static async handleTransferSuccess(webhookData) {
        try {
            const { FinancialTransaction, DriverEarnings } = await getFinancialModels();

            const reference = webhookData.reference || webhookData.data?.reference;

            // Find transaction
            const transaction = await FinancialTransaction.findOne({
                'gateway.reference': reference,
                transactionType: 'driver_payout'
            });

            if (!transaction) {
                console.error('❌ Transaction not found:', reference);
                return { success: false, message: 'Transaction not found' };
            }

            // Prevent duplicate processing
            if (transaction.status === 'completed') {
                console.log('⚠️ Transaction already completed:', reference);
                return { success: true, message: 'Already completed' };
            }

            // Update transaction
            transaction.status = 'completed';
            transaction.payout.transferStatus = 'success';
            transaction.processedAt = new Date();
            transaction.gateway.metadata.webhook_received_at = new Date();
            transaction.gateway.metadata.webhook_data = webhookData;

            await transaction.save();

            // Update driver earnings
            const driverEarnings = await DriverEarnings.findOne({
                driverId: transaction.driverId
            });

            if (!driverEarnings) {
                console.log('❌ Driver earnings not found');
                return { success: false, message: 'Driver earnings not found' };
            }

            // Find the specific pending transfer
            const pendingIndex = driverEarnings.pendingTransfers.findIndex(
                pt => pt.paystackReference === reference && pt.status === 'pending'
            );

            if (pendingIndex === -1) {
                console.log('❌ No pending transfer found for:', reference);
                return { success: false, message: 'No pending transfer found' };
            }

            const pendingTransfer = driverEarnings.pendingTransfers[pendingIndex];

            // CRITICAL: Update the specific pending transfer
            pendingTransfer.status = 'completed';
            pendingTransfer.processedAt = new Date();
            pendingTransfer.webhookData = webhookData;
            pendingTransfer.lastVerifiedAt = new Date();

            // Update financial totals
            // availableBalance was already reduced, so we don't touch it
            // We only update the accounting fields
            driverEarnings.earnings.available -= pendingTransfer.requestedAmount;
            driverEarnings.earnings.withdrawn += pendingTransfer.requestedAmount;
            driverEarnings.lifetime.totalWithdrawn += pendingTransfer.requestedAmount;

            // Update recent payout status
            const recentPayoutIndex = driverEarnings.recentPayouts.findIndex(
                p => p.transactionId.toString() === transaction._id.toString()
            );

            if (recentPayoutIndex !== -1) {
                driverEarnings.recentPayouts[recentPayoutIndex].status = 'completed';
                driverEarnings.recentPayouts[recentPayoutIndex].processedAt = new Date();
            }

            await driverEarnings.save();

            console.log('✅ Transfer completed successfully:', {
                reference,
                amount: pendingTransfer.requestedAmount,
                driverId: transaction.driverId
            });

            return { success: true, message: 'Transfer completed successfully' };

        } catch (error) {
            console.error('❌ Error handling transfer success:', error);
            return { success: false, message: error.message };
        }
    }

    /**
     * Handle webhook FAILED - CORRECTED VERSION
     */
    static async handleTransferFailed(webhookData) {
        try {
            const { FinancialTransaction, DriverEarnings } = await getFinancialModels();

            const reference = webhookData.reference || webhookData.data?.reference;

            // Find transaction
            const transaction = await FinancialTransaction.findOne({
                'gateway.reference': reference,
                transactionType: 'driver_payout'
            });

            if (!transaction) {
                console.error('❌ Transaction not found:', reference);
                return { success: false, message: 'Transaction not found' };
            }

            // Prevent duplicate processing
            if (transaction.status === 'failed' || transaction.status === 'reversed') {
                console.log('⚠️ Transaction already processed as failed:', reference);
                return { success: true, message: 'Already processed' };
            }

            // Update transaction
            transaction.status = 'failed';
            transaction.payout.transferStatus = 'failed';
            transaction.processedAt = new Date();
            transaction.gateway.metadata.webhook_received_at = new Date();
            transaction.gateway.metadata.webhook_data = webhookData;
            transaction.gateway.metadata.failure_reason =
                webhookData.failures ||
                webhookData.data?.failures ||
                'Transfer failed';

            await transaction.save();

            // Update driver earnings - RESTORE BALANCE
            const driverEarnings = await DriverEarnings.findOne({
                driverId: transaction.driverId
            });

            if (!driverEarnings) {
                console.error('❌ Driver earnings not found');
                return { success: false, message: 'Driver earnings not found' };
            }

            // Find the pending transfer
            const pendingIndex = driverEarnings.pendingTransfers.findIndex(
                pt => pt.paystackReference === reference && pt.status === 'pending'
            );

            if (pendingIndex !== -1) {
                const pendingTransfer = driverEarnings.pendingTransfers[pendingIndex];

                // Mark as failed
                pendingTransfer.status = 'failed';
                pendingTransfer.processedAt = new Date();
                pendingTransfer.webhookData = webhookData;

                // CRITICAL: Restore the balance
                driverEarnings.availableBalance += pendingTransfer.requestedAmount;

                console.log('💰 Balance restored:', {
                    reference,
                    amount: pendingTransfer.requestedAmount,
                    newBalance: driverEarnings.availableBalance
                });
            }

            // Update recent payout
            const recentPayoutIndex = driverEarnings.recentPayouts.findIndex(
                p => p.transactionId.toString() === transaction._id.toString()
            );

            if (recentPayoutIndex !== -1) {
                driverEarnings.recentPayouts[recentPayoutIndex].status = 'failed';
                driverEarnings.recentPayouts[recentPayoutIndex].processedAt = new Date();
            }

            await driverEarnings.save();

            console.log('✅ Transfer failed, funds restored:', reference);
            return { success: true, message: 'Transfer failed, funds restored' };

        } catch (error) {
            console.error('❌ Error handling transfer failure:', error);
            return { success: false, message: error.message };
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
     * Handle transfer webhook - REVERSED
     */
    static async handleTransferReversed(webhookData) {
        // Same logic as failed
        return await FinancialService.handleTransferFailed(webhookData);
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

    static async getFinancialSummary(driverId) {
        try {
            const { DriverEarnings } = await getFinancialModels();

            // TEMPORARY: Get raw document without any transformations
            const rawDoc = await DriverEarnings.findOne({ driverId })
                .lean()
                .exec();

            console.log('RAW DOCUMENT:', {
                pending: rawDoc.earnings.pending,
                available: rawDoc.earnings.available,
                withdrawn: rawDoc.earnings.withdrawn
            });

            // Method 1: Normal Mongoose query
            const mongooseDoc = await DriverEarnings.findOne({ driverId });
            console.log('MONGOOSE DOC - pending:', mongooseDoc.earnings.pending);

            // Method 2: Raw collection query
            const rawFromCollection = await DriverEarnings.collection.findOne({
                driverId: new mongoose.Types.ObjectId(driverId)
            });
            console.log('RAW COLLECTION - pending:', rawFromCollection.earnings.pending);

            // Method 3: With lean
            const leanDoc = await DriverEarnings.findOne({ driverId }).lean();
            console.log('LEAN DOC - pending:', leanDoc.earnings.pending);

            return rawDoc; // Return this temporarily to test
        } catch (error) {
            console.error('Error getting financial summary:', error);
            throw error;
        }
    }

    /**
     * Manual reconciliation for stuck transfers
     */
    static async reconcilePendingTransfers(driverId) {
        const { DriverEarnings, FinancialTransaction } = await getFinancialModels();

        const driverEarnings = await DriverEarnings.findOne({ driverId });
        if (!driverEarnings) {
            return { success: false, message: 'Driver earnings not found' };
        }

        const pendingTransfers = driverEarnings.pendingTransfers.filter(
            pt => pt.status === 'pending' || pt.requiresManualCheck
        );

        const results = {
            reconciled: 0,
            failed: 0,
            stillPending: 0,
            details: []
        };

        for (const pendingTransfer of pendingTransfers) {
            try {
                console.log(`Reconciling transfer: ${pendingTransfer.paystackReference}`);

                // Check Paystack status for this reference
                const paystackStatus = await FinancialService.verifyPaystackTransfer(pendingTransfer.paystackReference);

                if (paystackStatus.success && paystackStatus.data) {
                    const paystackData = paystackStatus.data;

                    // Update based on Paystack status
                    switch (paystackData.status) {
                        case 'success':
                            await FinancialService.handleTransferSuccess({
                                reference: pendingTransfer.paystackReference,
                                data: paystackData
                            });
                            results.reconciled++;
                            results.details.push({
                                reference: pendingTransfer.paystackReference,
                                status: 'completed',
                                message: 'Successfully reconciled from pending to completed'
                            });
                            break;

                        case 'failed':
                            await FinancialService.handleTransferFailed({
                                reference: pendingTransfer.paystackReference,
                                data: paystackData
                            });
                            results.reconciled++;
                            results.details.push({
                                reference: pendingTransfer.paystackReference,
                                status: 'failed',
                                message: 'Transfer failed, funds restored'
                            });
                            break;

                        default:
                            // Still processing
                            pendingTransfer.lastVerifiedAt = new Date();
                            pendingTransfer.requiresManualCheck = true;
                            results.stillPending++;
                            results.details.push({
                                reference: pendingTransfer.paystackReference,
                                status: 'still_pending',
                                message: `Transfer still in ${paystackData.status} state`
                            });
                    }
                } else {
                    results.failed++;
                    results.details.push({
                        reference: pendingTransfer.paystackReference,
                        status: 'verification_failed',
                        message: 'Could not verify with Paystack'
                    });
                }
            } catch (error) {
                console.error(`Error reconciling transfer ${pendingTransfer.paystackReference}:`, error);
                results.failed++;
                results.details.push({
                    reference: pendingTransfer.paystackReference,
                    status: 'error',
                    message: error.message
                });
            }
        }

        // Save any updates to pending transfers
        await driverEarnings.save();

        return {
            success: true,
            ...results,
            totalChecked: pendingTransfers.length
        };
    }

    /**
     * Verify transfer with Paystack
     */
    static async verifyPaystackTransfer(reference) {
        try {
            const response = await axios.get(
                `https://api.paystack.co/transfer/verify/${reference}`,
                {
                    headers: {
                        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            return response.data;
        } catch (error) {
            console.error('Paystack verification error:', error.response?.data || error.message);
            throw error;
        }
    }

    /**
     * Get driver's pending transfers for display
     */
    static async getPendingTransfers(driverId) {
        const { DriverEarnings } = await getFinancialModels();

        const driverEarnings = await DriverEarnings.findOne({ driverId });
        if (!driverEarnings) {
            return [];
        }

        return driverEarnings.pendingTransfers
            .filter(pt => pt.status === 'pending')
            .sort((a, b) => new Date(b.requestedAt) - new Date(a.requestedAt));
    }






    // ============================================
// MANUAL RECONCILIATION SYSTEM
// ============================================

    /**
     * Reconcile specific payout by reference
     * Call this when webhook hasn't arrived after reasonable time
     */
    static async reconcilePayoutByReference(reference) {
        try {
            const { FinancialTransaction, DriverEarnings } = await getFinancialModels();

            console.log(`🔍 Reconciling payout: ${reference}`);

            // 1. Get our transaction
            const transaction = await FinancialTransaction.findOne({
                'gateway.reference': reference,
                transactionType: 'driver_payout'
            });

            if (!transaction) {
                return {
                    success: false,
                    message: 'Transaction not found',
                    reference
                };
            }

            // If already in final state, return current status
            if (['completed', 'failed', 'reversed'].includes(transaction.status)) {
                return {
                    success: true,
                    message: 'Transaction already in final state',
                    reference,
                    status: transaction.status,
                    alreadyProcessed: true
                };
            }

            // 2. Query Paystack for current status
            let paystackData;
            try {
                const response = await axios.get(
                    `https://api.paystack.co/transfer/verify/${reference}`,
                    {
                        headers: {
                            Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
                            'Content-Type': 'application/json'
                        }
                    }
                );

                if (!response.data.status || !response.data.data) {
                    throw new Error('Invalid Paystack response');
                }

                paystackData = response.data.data;

            } catch (paystackError) {
                // If Paystack returns 404, transfer not found yet
                if (paystackError.response?.status === 404) {
                    return {
                        success: false,
                        message: 'Transfer not yet visible in Paystack system',
                        reference,
                        suggestion: 'Wait a few more minutes and try again'
                    };
                }

                throw new Error(
                    `Paystack verification failed: ${
                        paystackError.response?.data?.message || paystackError.message
                    }`
                );
            }

            // 3. Process based on Paystack status
            const paystackStatus = paystackData.status;
            console.log(`📊 Paystack status for ${reference}: ${paystackStatus}`);

            let reconciliationResult;

            switch (paystackStatus) {
                case 'success':
                    reconciliationResult = await FinancialService.handleTransferSuccess({
                        reference,
                        data: paystackData
                    });
                    break;

                case 'failed':
                    reconciliationResult = await FinancialService.handleTransferFailed({
                        reference,
                        data: paystackData
                    });
                    break;

                case 'reversed':
                    reconciliationResult = await FinancialService.handleTransferReversed({
                        reference,
                        data: paystackData
                    });
                    break;

                case 'pending':
                case 'processing':
                case 'otp':
                case 'queued':
                    // Still processing - update last verified time
                    const driverEarnings = await DriverEarnings.findOne({
                        driverId: transaction.driverId
                    });

                    if (driverEarnings) {
                        const pendingTransfer = driverEarnings.pendingTransfers.find(
                            pt => pt.paystackReference === reference
                        );

                        if (pendingTransfer) {
                            pendingTransfer.lastVerifiedAt = new Date();
                            pendingTransfer.paystackResponse = paystackData;
                            await driverEarnings.save();
                        }
                    }

                    return {
                        success: true,
                        message: 'Transfer still processing',
                        reference,
                        paystackStatus,
                        stillPending: true,
                        suggestion: 'Check again in a few minutes'
                    };

                default:
                    return {
                        success: false,
                        message: `Unknown Paystack status: ${paystackStatus}`,
                        reference,
                        paystackStatus
                    };
            }

            return {
                success: true,
                message: 'Reconciliation completed',
                reference,
                paystackStatus,
                reconciliationResult
            };

        } catch (error) {
            console.error('❌ Reconciliation error:', error);
            return {
                success: false,
                message: error.message,
                reference,
                error: error.message
            };
        }
    }

    /**
     * Reconcile all pending transfers for a driver
     * Useful for cron job or admin action
     */
    static async reconcileAllPendingForDriver(driverId) {
        try {
            const { DriverEarnings } = await getFinancialModels();

            const driverEarnings = await DriverEarnings.findOne({ driverId });
            if (!driverEarnings) {
                return {
                    success: false,
                    message: 'Driver earnings not found'
                };
            }

            // Get all pending transfers
            const pendingTransfers = driverEarnings.pendingTransfers.filter(
                pt => pt.status === 'pending'
            );

            if (pendingTransfers.length === 0) {
                return {
                    success: true,
                    message: 'No pending transfers to reconcile',
                    count: 0
                };
            }

            console.log(`🔄 Reconciling ${pendingTransfers.length} pending transfers for driver ${driverId}`);

            const results = {
                total: pendingTransfers.length,
                completed: 0,
                failed: 0,
                stillPending: 0,
                errors: 0,
                details: []
            };

            // Process each pending transfer
            for (const pendingTransfer of pendingTransfers) {
                const result = await FinancialService.reconcilePayoutByReference(
                    pendingTransfer.paystackReference
                );

                if (result.success) {
                    if (result.alreadyProcessed) {
                        results.completed++;
                    } else if (result.stillPending) {
                        results.stillPending++;
                    } else if (result.paystackStatus === 'success') {
                        results.completed++;
                    } else if (result.paystackStatus === 'failed' || result.paystackStatus === 'reversed') {
                        results.failed++;
                    }
                } else {
                    results.errors++;
                }

                results.details.push({
                    reference: pendingTransfer.paystackReference,
                    amount: pendingTransfer.requestedAmount,
                    result: result
                });

                // Add small delay between API calls to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 500));
            }

            console.log('✅ Reconciliation complete:', results);

            return {
                success: true,
                message: 'Reconciliation completed',
                results
            };

        } catch (error) {
            console.error('❌ Error reconciling pending transfers:', error);
            return {
                success: false,
                message: error.message
            };
        }
    }

    /**
     * Reconcile ALL stuck transfers across all drivers
     * Run this as a cron job every 30 minutes
     */
    static async reconcileAllStuckTransfers(olderThanMinutes = 30) {
        try {
            const { DriverEarnings } = await getFinancialModels();

            const cutoffTime = new Date(Date.now() - olderThanMinutes * 60 * 1000);

            // Find all drivers with old pending transfers
            const driversWithStuck = await DriverEarnings.find({
                'pendingTransfers': {
                    $elemMatch: {
                        status: 'pending',
                        requestedAt: { $lt: cutoffTime }
                    }
                }
            });

            console.log(`🔍 Found ${driversWithStuck.length} drivers with stuck transfers`);

            const results = {
                driversProcessed: 0,
                totalTransfers: 0,
                completed: 0,
                failed: 0,
                stillPending: 0,
                errors: 0
            };

            for (const driverEarning of driversWithStuck) {
                console.log(`Processing driver: ${driverEarning.driverId}`);

                const driverResult = await FinancialService.reconcileAllPendingForDriver(
                    driverEarning.driverId
                );

                if (driverResult.success && driverResult.results) {
                    results.driversProcessed++;
                    results.totalTransfers += driverResult.results.total;
                    results.completed += driverResult.results.completed;
                    results.failed += driverResult.results.failed;
                    results.stillPending += driverResult.results.stillPending;
                    results.errors += driverResult.results.errors;
                }

                // Delay between drivers
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            console.log('✅ Global reconciliation complete:', results);

            return {
                success: true,
                message: 'Global reconciliation completed',
                results
            };

        } catch (error) {
            console.error('❌ Error in global reconciliation:', error);
            return {
                success: false,
                message: error.message
            };
        }
    }

    /**
     * Get reconciliation report for a driver
     */
    static async getReconciliationReport(driverId) {
        try {
            const { DriverEarnings, FinancialTransaction } = await getFinancialModels();

            const driverEarnings = await DriverEarnings.findOne({ driverId });
            if (!driverEarnings) {
                return { success: false, message: 'Driver not found' };
            }

            // Get all payout transactions
            const allPayouts = await FinancialTransaction.find({
                driverId,
                transactionType: 'driver_payout'
            }).sort({ createdAt: -1 });

            // Categorize
            const pending = driverEarnings.pendingTransfers.filter(pt => pt.status === 'pending');
            const completed = allPayouts.filter(p => p.status === 'completed');
            const failed = allPayouts.filter(p => p.status === 'failed' || p.status === 'reversed');

            // Calculate totals
            const pendingAmount = pending.reduce((sum, pt) => sum + pt.requestedAmount, 0);
            const completedAmount = completed.reduce((sum, tx) => sum + tx.amount.gross, 0);
            const failedAmount = failed.reduce((sum, tx) => sum + tx.amount.gross, 0);

            // Check for discrepancies
            const expectedAvailable =
                driverEarnings.earnings.available + pendingAmount;
            const actualAvailable = driverEarnings.availableBalance;

            const discrepancy = Math.abs(expectedAvailable - actualAvailable);
            const hasDiscrepancy = discrepancy > 1; // Allow 1 NGN rounding error

            return {
                success: true,
                report: {
                    summary: {
                        availableBalance: driverEarnings.availableBalance,
                        pendingCount: pending.length,
                        pendingAmount,
                        completedCount: completed.length,
                        completedAmount,
                        failedCount: failed.length,
                        failedAmount,
                        totalWithdrawn: driverEarnings.lifetime.totalWithdrawn
                    },
                    integrity: {
                        hasDiscrepancy,
                        discrepancy,
                        expectedAvailable,
                        actualAvailable,
                        status: hasDiscrepancy ? 'NEEDS_REVIEW' : 'OK'
                    },
                    pending: pending.map(pt => ({
                        reference: pt.paystackReference,
                        amount: pt.requestedAmount,
                        requestedAt: pt.requestedAt,
                        ageMinutes: Math.round(
                            (Date.now() - new Date(pt.requestedAt).getTime()) / 60000
                        ),
                        requiresManualCheck: pt.requiresManualCheck
                    })),
                    recentActivity: driverEarnings.recentPayouts.slice(0, 5)
                }
            };

        } catch (error) {
            console.error('Error generating reconciliation report:', error);
            return { success: false, message: error.message };
        }
    }

    static formatAge(milliseconds) {
        const minutes = Math.floor(milliseconds / 60000);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
        if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
        if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
        return 'Just now';
    }
}

export default FinancialService;
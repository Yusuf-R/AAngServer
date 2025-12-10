import FinancialService from '../services/FinancialService';
import OrderController from './OrderController';
import crypto from 'crypto';
import getFinancialModels from "../models/Finance/FinancialTransactions";

class WebhookController {
    /**
     * Handle Paystack webhooks for transfer or charge events
     */
    static async handlePaystackWebhook(req, res) {
        try {
            // Verify webhook signature
            const hash = crypto
                .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
                .update(JSON.stringify(req.body))
                .digest('hex');

            if (hash !== req.headers['x-paystack-signature']) {
                console.log('Invalid webhook signature');
                return res.status(400).json({error: 'Invalid signature'});
            }

            const parsedBody = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
            const {event, data} = parsedBody;
            console.log('Webhook received:', {event, reference: data?.reference, data});

            if (event === 'charge.success' && data.metadata?.type === 'wallet_topup') {
                const {FinancialTransaction} = await getFinancialModels();

                const existingTransaction = await FinancialTransaction.findOne({
                    'gateway.reference': data.reference,
                    transactionType: 'wallet_deposit',
                    status: 'completed'
                });

                if (existingTransaction) {
                    console.log('⚠️ Webhook already processed, skipping:', data.reference);
                    return res.status(200).json({message: 'Webhook already processed'});
                }
            }


            let result;

            switch (event) {
                // Transfer Related
                case 'transfer.success':
                    result = await FinancialService.handleTransferSuccess(data);
                    await WebhookController.emitPayoutUpdate(data.reference, 'completed');
                    break;

                case 'transfer.failed':
                    result = await FinancialService.handleTransferFailed(data);
                    await WebhookController.emitPayoutUpdate(data.reference, 'failed');
                    break;

                case 'transfer.reversed':
                    result = await FinancialService.handleTransferReversed(data);
                    await WebhookController.emitPayoutUpdate(data.reference, 'reversed');
                    break;

                // Charge Related (existing)
                case 'charge.success':
                    // Check metadata to determine payment type
                    if (data.metadata?.type === 'wallet_topup') {
                        // Client wallet top-up
                        result = await WebhookController.handleWalletTopUpSuccess(data);
                    } else {
                        // Order payment
                        result = await OrderController.handleSuccessfulCharge(data);
                    }
                    break;

                case 'charge.failed':
                    // Handle failed charge (applies to both order and wallet)
                    if (data.metadata?.type === 'wallet_topup') {
                        result = await WebhookController.handleWalletTopUpFailed(data);
                    } else {
                        result = await OrderController.handleFailedCharge(data);
                    }
                    break;

                default:
                    console.log(`Unhandled webhook event: ${event}`);
                    return res.status(200).json({message: 'Event received but not processed'});
            }

            if (result?.success === false) {
                console.log('⚠️ Webhook processing completed with issues:', result?.message);
                return res.status(200).json({message: 'Webhook processed with issues'});
            }

            console.log('✅ Webhook processed successfully');
            return res.status(200).json({message: 'Webhook processed successfully'});
        } catch (error) {
            console.log('Webhook processing error:', error);
            return res.status(500).json({error: 'Webhook processing failed'});
        }
    }

    /**
     * ============================================
     * WALLET TOP-UP SUCCESS HANDLER
     * ============================================
     */
    static async handleWalletTopUpSuccess(data) {
        try {
            const {reference, metadata} = data;

            // Double-check this is a wallet top-up
            if (metadata?.type !== 'wallet_topup') {
                console.log('⚠️ Not a wallet top-up, skipping');
                return {success: false, message: 'Not a wallet top-up'};
            }

            const {FinancialTransaction, ClientWallet} = await getFinancialModels();

            // Calculate final amounts (Paystack amounts are in kobo)
            const grossAmount = data.amount / 100;
            const fee = (data.fees || 0) / 100;
            const netAmount = grossAmount - fee;

            // ✅ FIX: Use findOneAndUpdate with atomic operation
            // This ensures only ONE webhook/verification can mark it completed
            const transaction = await FinancialTransaction.findOneAndUpdate(
                {
                    'gateway.reference': reference,
                    transactionType: 'wallet_deposit',
                    status: 'pending' // ⚠️ CRITICAL: Only update if still pending
                },
                {
                    $set: {
                        'amount.gross': grossAmount,
                        'amount.fees': fee,
                        'amount.net': netAmount,
                        status: 'completed',
                        processedAt: new Date(),
                        'gateway.metadata': {
                            ...metadata,
                            type: 'wallet_topup',
                            webhook_received_at: new Date(),
                            webhook_data: data,
                            paystack_transaction_id: data.id,
                            paystack_customer: data.customer
                        }
                    }
                },
                {
                    new: false, // Return the OLD document (before update)
                    runValidators: true
                }
            );

            if (!transaction) {
                console.log('⚠️ Transaction not found or already processed:', reference);
                return {success: true, message: 'Already processed or not found'};
            }

            // ✅ If transaction was already completed, don't process wallet
            if (transaction.status === 'completed') {
                console.log('⚠️ Wallet top-up already processed (race condition avoided):', reference);
                return {success: true, message: 'Already processed'};
            }

            console.log('💰 Processing wallet top-up:', {
                reference,
                grossAmount,
                fee,
                netAmount,
                clientId: transaction.clientId
            });

            // ✅ Now safe to credit wallet - we won the race
            let clientWallet = await ClientWallet.findOne({
                clientId: transaction.clientId
            });

            if (!clientWallet) {
                console.log('📝 Creating new wallet for client:', transaction.clientId);
                clientWallet = new ClientWallet({
                    clientId: transaction.clientId,
                    balance: 0,
                    lifetime: {
                        totalDeposited: 0,
                        totalSpent: 0,
                        totalRefunded: 0,
                        transactionCount: 0
                    },
                    recentTransactions: [],
                    status: 'active'
                });
            }

            // Credit wallet
            const balanceBefore = clientWallet.balance;
            clientWallet.balance += netAmount;

            // Update lifetime stats
            clientWallet.lifetime.totalDeposited += netAmount;
            clientWallet.lifetime.transactionCount += 1;
            clientWallet.lifetime.lastActivityAt = new Date();

            if (!clientWallet.lifetime.firstDepositAt) {
                clientWallet.lifetime.firstDepositAt = new Date();
            }

            // Ensure recentTransactions is an array
            if (!Array.isArray(clientWallet.recentTransactions)) {
                console.log('⚠️ Fixing recentTransactions - was not an array');
                clientWallet.recentTransactions = [];
            }

            const newTransaction = {
                transactionId: transaction._id,
                type: 'deposit',
                amount: netAmount,
                balanceAfter: clientWallet.balance,
                createdAt: new Date(),
                description: `Wallet top-up (Ref: ${reference})`
            };

            clientWallet.recentTransactions.unshift(newTransaction);

            if (clientWallet.recentTransactions.length > 50) {
                clientWallet.recentTransactions = clientWallet.recentTransactions.slice(0, 50);
            }

            await clientWallet.save();

            console.log('✅ Wallet credited successfully (via webhook):', {
                reference,
                clientId: transaction.clientId,
                balanceBefore,
                balanceAfter: clientWallet.balance,
                credited: netAmount
            });

            return {
                success: true,
                message: 'Wallet top-up processed successfully',
                data: {
                    reference,
                    netAmount,
                    newBalance: clientWallet.balance
                }
            };

        } catch (error) {
            console.error('❌ Error handling wallet top-up success:', error);
            return {
                success: false,
                message: error.message
            };
        }
    }

    /**
     * ============================================
     * WALLET TOP-UP FAILED HANDLER
     * ============================================
     */
    static async handleWalletTopUpFailed(data) {
        try {
            const {reference, gateway_response, metadata} = data;

            // Double-check this is a wallet top-up
            if (metadata?.type !== 'wallet_topup') {
                console.log('⚠️ Not a wallet top-up, skipping');
                return {success: false, message: 'Not a wallet top-up'};
            }

            const {FinancialTransaction} = await getFinancialModels();

            // Find the transaction
            const transaction = await FinancialTransaction.findOne({
                'gateway.reference': reference,
                transactionType: 'wallet_deposit'
            });

            if (!transaction) {
                console.log('❌ Transaction not found:', reference);
                return {success: false, message: 'Transaction not found'};
            }

            // Update transaction status
            transaction.status = 'failed';
            transaction.gateway.metadata = {
                ...transaction.gateway.metadata,
                webhook_received_at: new Date(),
                webhook_data: data,
                failure_reason: gateway_response || 'Payment failed'
            };
            transaction.processedAt = new Date();

            await transaction.save();

            console.log('💔 Wallet top-up failed:', {
                reference,
                clientId: transaction.clientId,
                reason: gateway_response
            });

            // Emit WebSocket event for failure
            if (global.io) {
                global.io.to(`user:${transaction.clientId}`).emit('wallet:topup:failed', {
                    reference,
                    reason: gateway_response || 'Payment failed',
                    timestamp: new Date().toISOString()
                });
            }

            return {
                success: true,
                message: 'Wallet top-up failure processed'
            };

        } catch (error) {
            console.log('❌ Error handling wallet top-up failure:', error);
            return {
                success: false,
                message: error.message
            };
        }
    }

    static async test(req, res) {
        return res.status(200).json({message: 'Webhook processed successfully'});
    }

    static async verifyWebhookSignature(payload, signature) {
        const hash = crypto
            .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
            .update(payload, 'utf8')
            .digest('hex');

        return hash === signature;
    };

    /**
     * 🔥 NEW: Emit WebSocket events for payout status updates
     */
    static async emitPayoutUpdate(paystackReference, status) {
        try {
            const {FinancialTransaction} = await getFinancialModels();

            // Find the transaction by Paystack reference
            const transaction = await FinancialTransaction.findOne({
                'gateway.reference': paystackReference
            });

            if (!transaction) {
                console.log('Transaction not found for reference:', paystackReference);
                return;
            }

            const driverId = transaction.driverId.toString();

            // Create payload for frontend
            const payload = {
                payoutId: transaction._id.toString(),
                status: status,
                amount: transaction.amount,
                reference: transaction.gateway.reference,
                timestamp: new Date().toISOString()
            };

            console.log(`💰 Emitting payout update to driver ${driverId}:`, payload);

            // Emit to specific driver's room
            if (global.io) {
                // Emit general status update
                global.io.to(`user:${driverId}`).emit('payout:status:updated', payload);

                // Emit specific events for better frontend handling
                if (status === 'completed') {
                    global.io.to(`user:${driverId}`).emit('payout:transfer:completed', {
                        ...payload,
                        netAmount: transaction.payout.netAmount
                    });
                } else if (status === 'failed' || status === 'reversed') {
                    global.io.to(`user:${driverId}`).emit('payout:transfer:failed', payload);
                }

                console.log(`✅ WebSocket event emitted for payout ${transaction._id} -> ${status}`);
            } else {
                console.log('Socket.IO not available for emitting payout update');
            }

        } catch (error) {
            console.log('Error emitting WebSocket payout update:', error);
        }
    }

}

module.exports = WebhookController;
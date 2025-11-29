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
                return res.status(400).json({ error: 'Invalid signature' });
            }

            const parsedBody = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
            const {event, data} = parsedBody;
            console.log('Webhook received:', {event, reference: data?.reference, data});
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
                    await OrderController.handleSuccessfulCharge(data);
                    break;

                case 'charge.failed':
                    await OrderController.handleFailedCharge(data);
                    break;

                default:
                    console.log(`Unhandled webhook event: ${event}`);
                    return res.status(200).json({ message: 'Event received but not processed' });
            }

            console.log({
                result
            })

            if (result?.success) {
                return res.status(200).json({ message: 'Webhook processed successfully' });
            } else {
                return res.status(500).json({ error: result?.message });
            }

        } catch (error) {
            console.log('Webhook processing error:', error);
            return res.status(500).json({ error: 'Webhook processing failed' });
        }
    }

    static async test(req, res) {
        return res.status(200).json({ message: 'Webhook processed successfully' });
    }

    static async verifyWebhookSignature (payload, signature) {
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
            const { FinancialTransaction } = await getFinancialModels();

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
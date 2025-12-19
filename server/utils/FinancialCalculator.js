// utils/FinancialCalculator.js
// Intelligent revenue calculation for all payment methods

/**
 * Calculate complete financial breakdown for an order
 * This is the SINGLE SOURCE OF TRUTH for all financial calculations
 */
export function calculateOrderFinancials(pricingBreakdown, paymentMethod, walletAmount = 0, cardAmount = 0) {
    // Extract pricing engine data
    const originalDeliveryTotal = pricingBreakdown.finalSummary.deliveryTotal;
    const customerAmount = pricingBreakdown.finalSummary.customerAmount;
    const expectedPaystackFee = pricingBreakdown.paymentFees.processingFee;

    // Driver and Platform base shares (SACRED 70/30 split)
    const driverShare = Math.round(originalDeliveryTotal * 0.7);
    const platformBaseShare = Math.round(originalDeliveryTotal * 0.3);

    let actualPaystackFee = 0;
    let netReceived = 0;
    let platformBonusRevenue = 0;

    // Calculate based on payment method
    switch(paymentMethod) {
        case 'wallet':
            // 100% Wallet Payment
            actualPaystackFee = 0;
            netReceived = customerAmount; // We receive full amount from wallet
            platformBonusRevenue = expectedPaystackFee; // All fee becomes bonus
            break;

        case 'paystack':
            // 100% PayStack Payment
            actualPaystackFee = expectedPaystackFee;
            netReceived = originalDeliveryTotal; // PayStack takes fee, we get delivery total
            platformBonusRevenue = 0; // No bonus
            break;

        case 'hybrid':
            // Partial Wallet + PayStack
            // Calculate actual PayStack fee on card portion only
            actualPaystackFee = calculatePaystackFees(cardAmount).processingFee;

            // Net received = wallet amount + (card amount - actual PayStack fee)
            const netFromCard = cardAmount - actualPaystackFee;
            netReceived = walletAmount + netFromCard;

            // Bonus = expected fee - actual fee
            platformBonusRevenue = expectedPaystackFee - actualPaystackFee;
            break;
    }

    // Total platform revenue
    const platformTotalRevenue = platformBaseShare + platformBonusRevenue;

    return {
        customerAmount,
        originalDeliveryTotal,
        expectedPaystackFee,
        walletUsed: walletAmount,
        cardPaid: cardAmount,
        actualPaystackFee: Math.round(actualPaystackFee),
        netReceived: Math.round(netReceived),

        // Sacred 70/30 split
        driverShare,
        platformBaseShare,

        // Bonus revenue
        platformBonusRevenue: Math.round(platformBonusRevenue),
        bonusCalculation: {
            expectedFee: expectedPaystackFee,
            actualFee: Math.round(actualPaystackFee),
            saved: Math.round(platformBonusRevenue)
        },

        // Total platform earnings
        platformTotalRevenue: Math.round(platformTotalRevenue),

        currency: 'NGN'
    };
}

/**
 * Calculate PayStack fees (helper function)
 */
function calculatePaystackFees(amount) {
    const decimalFee = 0.015; // 1.5%
    const flatFee = 100;
    const feeCap = 2000;
    const flatFeeThreshold = 2500;

    const effectiveFlatFee = amount < flatFeeThreshold ? 0 : flatFee;
    const applicableFees = (decimalFee * amount) + effectiveFlatFee;

    let processingFee;
    if (applicableFees > feeCap) {
        processingFee = feeCap;
    } else {
        processingFee = applicableFees;
    }

    return {
        processingFee: Math.ceil(processingFee),
        effectiveFlatFee
    };
}

/**
 * Create financial transactions for an order
 * Returns array of transactions to be saved
 */
export function createOrderFinancialTransactions(order, financialBreakdown, walletTransaction = null) {
    const transactions = [];
    const orderId = order._id;
    const clientId = order.clientId;

    // 1. Driver Earning Transaction (70% of delivery total)
    transactions.push({
        transactionType: 'driver_earning',
        orderId,
        clientId,
        driverId: null, // Set when driver assigned
        amount: {
            gross: financialBreakdown.driverShare,
            fees: 0,
            net: financialBreakdown.driverShare,
            currency: 'NGN'
        },
        status: 'pending',
        gateway: {
            provider: order.payment.method.toLowerCase(),
            reference: `DRIVER-EARNING-${Date.now()}-${orderId}`
        },
        revenueBreakdown: {
            baseRevenue: financialBreakdown.driverShare,
            bonusRevenue: 0,
            totalRevenue: financialBreakdown.driverShare,
            revenueSource: 'delivery_split',
            originalDeliveryTotal: financialBreakdown.originalDeliveryTotal,
            expectedPaystackFee: financialBreakdown.expectedPaystackFee,
            actualPaystackFee: financialBreakdown.actualPaystackFee,
            calculationNotes: '70% driver share of delivery total'
        },
        metadata: {
            description: `Driver earning for order ${order.orderRef}`,
            relatedTransactionId: walletTransaction?._id
        },
        processedBy: 'system'
    });

    // 2. Platform Base Revenue Transaction (30% of delivery total)
    transactions.push({
        transactionType: 'platform_revenue',
        orderId,
        clientId,
        amount: {
            gross: financialBreakdown.platformBaseShare,
            fees: 0,
            net: financialBreakdown.platformBaseShare,
            currency: 'NGN'
        },
        status: 'completed',
        gateway: {
            provider: order.payment.method.toLowerCase(),
            reference: `PLATFORM-BASE-${Date.now()}-${orderId}`
        },
        revenueBreakdown: {
            baseRevenue: financialBreakdown.platformBaseShare,
            bonusRevenue: 0,
            totalRevenue: financialBreakdown.platformBaseShare,
            revenueSource: 'delivery_split',
            originalDeliveryTotal: financialBreakdown.originalDeliveryTotal,
            expectedPaystackFee: financialBreakdown.expectedPaystackFee,
            actualPaystackFee: financialBreakdown.actualPaystackFee,
            calculationNotes: '30% platform share of delivery total'
        },
        metadata: {
            description: `Platform base revenue for order ${order.orderRef}`,
            relatedTransactionId: walletTransaction?._id
        },
        processedBy: 'system',
        processedAt: new Date()
    });

    // 3. Platform Bonus Revenue Transaction (saved PayStack fees)
    if (financialBreakdown.platformBonusRevenue > 0) {
        transactions.push({
            transactionType: 'platform_bonus_revenue',
            orderId,
            clientId,
            amount: {
                gross: financialBreakdown.platformBonusRevenue,
                fees: 0,
                net: financialBreakdown.platformBonusRevenue,
                currency: 'NGN'
            },
            status: 'completed',
            gateway: {
                provider: order.payment.method.toLowerCase(),
                reference: `PLATFORM-BONUS-${Date.now()}-${orderId}`
            },
            revenueBreakdown: {
                baseRevenue: 0,
                bonusRevenue: financialBreakdown.platformBonusRevenue,
                totalRevenue: financialBreakdown.platformBonusRevenue,
                revenueSource: 'paystack_fee_saved',
                originalDeliveryTotal: financialBreakdown.originalDeliveryTotal,
                expectedPaystackFee: financialBreakdown.expectedPaystackFee,
                actualPaystackFee: financialBreakdown.actualPaystackFee,
                calculationNotes: `Saved PayStack fees: Expected ₦${financialBreakdown.expectedPaystackFee} - Actual ₦${financialBreakdown.actualPaystackFee} = ₦${financialBreakdown.platformBonusRevenue}`
            },
            metadata: {
                description: `Platform bonus revenue from wallet usage (order ${order.orderRef})`,
                paymentMethod: order.payment.method,
                walletUsed: financialBreakdown.walletUsed,
                relatedTransactionId: walletTransaction?._id
            },
            processedBy: 'system',
            processedAt: new Date()
        });
    }

    return transactions;
}

/**
 * Validate financial calculations match pricing engine
 */
export function validateFinancialIntegrity(order, financialBreakdown) {
    const errors = [];

    // Check driver + platform base = delivery total
    const sumCheck = financialBreakdown.driverShare + financialBreakdown.platformBaseShare;
    if (Math.abs(sumCheck - financialBreakdown.originalDeliveryTotal) > 1) {
        errors.push(`Revenue split mismatch: ${sumCheck} !== ${financialBreakdown.originalDeliveryTotal}`);
    }

    // Check bonus calculation
    const bonusCheck = financialBreakdown.expectedPaystackFee - financialBreakdown.actualPaystackFee;
    if (Math.abs(bonusCheck - financialBreakdown.platformBonusRevenue) > 1) {
        errors.push(`Bonus calculation error: ${bonusCheck} !== ${financialBreakdown.platformBonusRevenue}`);
    }

    // Check wallet + card = customer amount
    if (order.payment.method === 'Hybrid') {
        const paymentSum = financialBreakdown.walletUsed + financialBreakdown.cardPaid;
        if (Math.abs(paymentSum - financialBreakdown.customerAmount) > 1) {
            errors.push(`Payment split error: ${paymentSum} !== ${financialBreakdown.customerAmount}`);
        }
    }

    return {
        valid: errors.length === 0,
        errors
    };
}
import AuthController from "./AuthController";
import getOrderModels, {generateOrderRef} from "../models/Order";
import getModels from "../models/AAng/AAngLogistics";
import mongoose from "mongoose";
import {calculateTotalPrice} from "../utils/LogisticPricingEngine";
import axios from "axios";
import crypto from 'crypto';
import NotificationService from "../services/NotificationService";
import Notification from "../models/Notification";

const secret = process.env.PAYSTACK_SECRET_KEY;
const url = process.env.PAYSTACK_URL;
// Payment constants
const PAYMENT_STATUS = {
    PENDING: 'pending',
    PROCESSING: 'processing',
    PAID: 'paid',
    FAILED: 'failed',
    REFUNDED: 'refunded',
    CANCELLED: 'cancelled'
};
const ORDER_STATUS = {
    DRAFT: 'draft',
    SUBMITTED: 'submitted',
    CONFIRMED: 'confirmed',
    CANCELLED: 'cancelled'
};

// PayStack verification utility
const verifyPayStackTransaction = async (reference) => {
    try {
        const response = await axios.get(
            `https://api.paystack.co/transaction/verify/${reference}`,
            {
                headers: {
                    Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`
                },
                timeout: 10000
            }
        );
        return response.data;
    } catch (error) {
        console.log('PayStack Verification Error:', error.response?.data || error.message);
        throw new Error('Payment verification failed');
    }
};
// Webhook signature verification
const verifyWebhookSignature = (payload, signature) => {
    const hash = crypto
        .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
        .update(payload, 'utf8')  // Use payload directly
        .digest('hex');
    ;

    return hash === signature;
};
// Generate idempotency key
const generateIdempotencyKey = (orderId, attemptId) => {
    return crypto
        .createHash('sha256')
        .update(`${orderId}-${attemptId}-${Date.now()}`)
        .digest('hex')
        .substring(0, 32);
};

class OrderController {

    /**
     * Create a minimal draft order instance to get ID for file uploads
     * This allows users to upload images/videos before completing the full form
     */
    static async instantObject(req, res) {
        // Perform API pre-check
        const preCheckResult = await AuthController.apiPreCheck(req);
        const flag = true;

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {userData} = preCheckResult;
        const clientId = userData._id;

        try {
            const {Order} = await getOrderModels();
            const {AAngBase, Client, Driver} = await getModels();

            // Validate client exists
            const client = await Client.findById(clientId);
            if (!client) {
                throw new Error('Client not found');
            }

            // Create minimal draft order with only required fields
            const draftOrder = new Order({
                clientId,
                orderRef: generateOrderRef(),
                status: 'draft',

                // Minimal required structure to satisfy schema
                location: {
                    pickUp: {
                        address: 'TBD',
                        coordinates: {
                            type: 'Point',
                            coordinates: [0, 0]
                        },
                        locationType: 'residential'
                    },
                    dropOff: {
                        address: 'TBD',
                        coordinates: {
                            type: 'Point',
                            coordinates: [0, 0]
                        },
                        locationType: 'residential'
                    },
                },

                package: {
                    category: 'others',
                    description: 'Draft package'
                },
                payment: {
                    method: 'PayStack'
                },
                pricing: {
                    baseFare: 0,
                    totalAmount: 0
                },

                // Track draft progress
                metadata: {
                    createdBy: 'client',
                    channel: 'web',
                    sourceIP: req.ip,
                    userAgent: req.get('User-Agent'),
                    notes: 'Draft order for form completion',
                    draftProgress: {
                        step: 1,
                        completedSteps: [],
                        lastUpdated: new Date()
                    }
                },

                // Generate delivery token for later use
                deliveryToken: generateDeliveryToken(),

                orderInstantHistory: [{
                    status: 'draft',
                    timestamp: new Date(),
                    updatedBy: {
                        userId: clientId,
                        role: 'client'
                    },
                    notes: 'Draft order instantiated for form completion'
                }],
                orderTrackingHistory: [{
                    status: 'order_created',
                    timestamp: new Date(),
                    title: 'Order Created',
                    description: 'Your order has been created and is currently in draft status.',
                    icon: '📦',
                    isCompleted: true,
                    isCurrent: false,
                }]
            });


            await draftOrder.save();

            const orderData = draftOrder.toObject();

            // Fetch all orders for the client
            const orders = await Order.find({clientId}).sort({createdAt: -1});


            // Compute statistics via aggregation
            const results = await Order.aggregate([
                {$match: {clientId: new mongoose.Types.ObjectId(clientId)}},
                {
                    $group: {
                        _id: null,
                        total: {$sum: 1},
                        completed: {
                            $sum: {$cond: [{$eq: ["$status", "delivered"]}, 1, 0]}
                        },
                        active: {
                            $sum: {
                                $cond: [
                                    {
                                        $in: ["$status", [
                                            "draft", "pending", "broadcast", "assigned", "confirmed",
                                            "en_route_pickup", "arrived_pickup", "picked_up", "in_transit", "arrived_dropoff"
                                        ]]
                                    },
                                    1,
                                    0
                                ]
                            }
                        },
                        failed: {
                            $sum: {
                                $cond: [
                                    {$in: ["$status", ["cancelled", "failed", "returned"]]},
                                    1,
                                    0
                                ]
                            }
                        }
                    }
                }
            ]);

            const statistics = results[0] || {
                total: 0,
                completed: 0,
                active: 0,
                failed: 0
            };

            return res.status(201).json({
                message: "Draft order created successfully",
                order: {
                    orders: orders.map(order => order.toObject()),
                    statistics,
                    orderData
                }
            });

        } catch (err) {
            console.log("Draft order creation error:", err);
            return res.status(500).json({
                error: "Failed to create draft order"
            });
        }
    }

    static async createOrder(req, res) {
        // Perform API pre-check
        const preCheckResult = await AuthController.apiPreCheck(req);
        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {userData} = preCheckResult;
        const clientId = userData._id;

        try {
            const {Order} = await getOrderModels();
            const orderData = req.body;

            // Validate required fields
            if (!orderData.pickup || !orderData.dropoff || !orderData.package) {
                return res.status(400).json({error: "Missing required order fields"});
            }

            // Create new order instance
            const newOrder = new Order({
                ...orderData,
                clientId,
                orderRef: generateOrderRef(),
                status: 'draft',
                deliveryToken: generateDeliveryToken(),
                orderInstantHistory: [{
                    status: 'draft',
                    timestamp: new Date(),
                    updatedBy: {
                        userId: clientId,
                        role: 'client'
                    },
                    notes: 'Order created and saved as draft'
                }],
                orderTrackingHistory: [{
                    status: 'order_created',
                    timestamp: new Date(),
                    title: 'Order Created',
                    description: 'Your order has been created and is currently in draft status.',
                    icon: '📦',
                    isCompleted: true,
                    isCurrent: false,
                }]
            });

            await newOrder.save();

            // get dashboard data
            const dashboardData = await AuthController.userDashBoardData(userData);
            if (!dashboardData) {
                return res.status(404).json({error: "Dashboard data not found"});
            }
            // Inject the just-created order directly
            dashboardData.orderData = newOrder.toObject();

            // Fetch all orders for the client
            const orders = await Order.find({clientId}).sort({createdAt: -1});

            // Compute statistics via aggregation
            const results = await Order.aggregate([
                {$match: {clientId: new mongoose.Types.ObjectId(clientId)}},
                {
                    $group: {
                        _id: null,
                        total: {$sum: 1},
                        completed: {
                            $sum: {$cond: [{$eq: ["$status", "delivered"]}, 1, 0]}
                        },
                        active: {
                            $sum: {
                                $cond: [
                                    {
                                        $in: ["$status", [
                                            "draft", "pending", "broadcast", "assigned", "confirmed",
                                            "en_route_pickup", "arrived_pickup", "picked_up", "in_transit", "arrived_dropoff"
                                        ]]
                                    },
                                    1,
                                    0
                                ]
                            }
                        },
                        failed: {
                            $sum: {
                                $cond: [
                                    {$in: ["$status", ["cancelled", "failed", "returned"]]},
                                    1,
                                    0
                                ]
                            }
                        }
                    }
                }
            ]);

            const statistics = results[0] || {
                total: 0,
                completed: 0,
                active: 0,
                failed: 0
            };

            return res.status(201).json({
                message: "Order created successfully",
                user: dashboardData,
                order: {
                    orders: orders.map(order => order.toObject()),
                    statistics
                }
            });
        } catch (err) {
            console.log("Create order error:", err);
            return res.status(500).json({
                error: "Failed to create order"
            });
        }
    }

    static async getAllClientOrders(req, res) {
        console.log('First time get');
        // Perform API pre-check
        const preCheckResult = await AuthController.apiPreCheck(req);
        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {userData} = preCheckResult;
        const clientId = userData._id;

        try {
            const {Order} = await getOrderModels();
            const orders = await Order.find({clientId}).sort({createdAt: -1});

            // Compute statistics using aggregation
            const results = await Order.aggregate([
                {$match: {clientId: new mongoose.Types.ObjectId(clientId)}},
                {
                    $group: {
                        _id: null,
                        total: {$sum: 1},
                        completed: {
                            $sum: {$cond: [{$eq: ["$status", "delivered"]}, 1, 0]}
                        },
                        active: {
                            $sum: {
                                $cond: [
                                    {
                                        $in: ["$status", [
                                            "draft", "pending", "broadcast", "assigned", "confirmed",
                                            "en_route_pickup", "arrived_pickup", "picked_up", "in_transit", "arrived_dropoff"
                                        ]]
                                    },
                                    1,
                                    0
                                ]
                            }
                        },
                        failed: {
                            $sum: {
                                $cond: [
                                    {$in: ["$status", ["cancelled", "failed", "returned"]]},
                                    1,
                                    0
                                ]
                            }
                        }
                    }
                }
            ]);

            const statistics = results[0] || {
                total: 0,
                completed: 0,
                active: 0,
                failed: 0
            };

            // Bundle everything under a single 'order' object
            return res.status(200).json({
                message: "Orders retrieved successfully",
                order: {
                    orders: orders.map(order => order.toObject()),
                    statistics
                }
            });
        } catch (err) {
            console.log("Get all client orders error:", err);
            return res.status(500).json({
                error: "Failed to retrieve orders"
            });
        }
    }

    static async saveDraft(req, res) {
        // Perform API pre-check
        const preCheckResult = await AuthController.apiPreCheck(req);
        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {userData} = preCheckResult;
        const clientId = userData._id;
        const orderData = req.body;

        const determineLocationType = (address) => {
            if (!address) return 'residential';
            const addressLower = address.toLowerCase();
            if (addressLower.includes('hospital') || addressLower.includes('clinic') || addressLower.includes('medical')) {
                return 'hospital';
            }
            if (addressLower.includes('mall') || addressLower.includes('shopping') || addressLower.includes('plaza')) {
                return 'mall';
            }
            if (addressLower.includes('office') || addressLower.includes('corporate') || addressLower.includes('business')) {
                return 'office';
            }
            if (addressLower.includes('school') || addressLower.includes('university') || addressLower.includes('college')) {
                return 'school';
            }
            return 'residential';
        };

        // step 3 is review (+ insurance) and final pricing
        if (orderData.metadata?.draftProgress?.step === 3) {

            // Extract FE calculated total
            const frontendTotal = orderData.pricing?.totalAmount;

            const frontendInsurance = orderData.insurance;

            console.log({
                frontendTotal,
                frontendInsurance
            })

            // Prepare data for BE calculation
            const pricingInput = {
                package: {
                    weight: orderData.package?.weight || {value: 1, unit: 'kg'},
                    category: orderData.package?.category || 'parcel',
                    isFragile: orderData.package?.isFragile || false,
                    requiresSpecialHandling: orderData.package?.requiresSpecialHandling || false,
                    declaredValue: frontendInsurance?.declaredValue || 0,
                    description: orderData.package?.description,
                    dimensions: orderData.package?.dimensions
                },
                location: {
                    pickUp: {
                        ...orderData.location?.pickUp,
                        locationType: determineLocationType(orderData.location?.pickUp?.address)
                    },
                    dropOff: {
                        ...orderData.location?.dropOff,
                        locationType: determineLocationType(orderData.location?.dropOff?.address)
                    }
                },
                priority: orderData.priority || 'normal',
                insurance: {
                    isInsured: frontendInsurance?.isInsured || false,
                    declaredValue: frontendInsurance?.declaredValue || 0
                },
                vehicleRequirements: orderData.vehicleRequirements || []
            };

            // Calculate on BE
            const backendPricing = calculateTotalPrice(pricingInput);
            const backendTotal = backendPricing.displayBreakdown.total;

            // Security check - compare totals
            const tolerance = Math.max(1, Math.round(frontendTotal * 0.001)); // 0.1% or minimum 1 NGN
            if (Math.abs(frontendTotal - backendTotal) > tolerance) {
                console.log('Pricing mismatch:', {
                    frontend: frontendTotal,
                    backend: backendTotal,
                    difference: frontendTotal - backendTotal,
                    tolerance
                });
                return res.status(400).json({
                    error: "Pricing verification failed",
                    debug: process.env.NODE_ENV === 'development' ? {
                        frontendTotal,
                        backendTotal,
                        difference: frontendTotal - backendTotal
                    } : undefined
                });
            }

            // Update orderData with BE-verified pricing and insurance
            orderData.pricing = backendPricing.backendPricing;
            orderData.insurance = {
                ...frontendInsurance,
                verified: true,
                verifiedAt: new Date()
            };
            console.log('Pricing and insurance verified by backend');
        }

        try {
            const {Order} = await getOrderModels();

            const order = await Order.findOneAndUpdate(
                {_id: orderData._id, clientId},
                {
                    $set: {
                        // All the main fields
                        package: orderData.package,
                        location: orderData.location,
                        vehicleRequirements: orderData.vehicleRequirements,
                        pricing: orderData.pricing,
                        insurance: orderData.insurance,
                        priority: orderData.priority,
                        orderType: orderData.orderType,

                        // Metadata updates with derived fieldCompletion
                        'metadata.draftProgress.step': orderData.metadata.draftProgress.step,
                        'metadata.draftProgress.completedSteps': orderData.metadata.draftProgress.completedSteps,
                        'metadata.draftProgress.lastUpdated': new Date(),
                        'metadata.draftProgress.fieldCompletion.package': orderData.metadata.draftProgress.completedSteps?.includes(0) || false,
                        'metadata.draftProgress.fieldCompletion.location': orderData.metadata.draftProgress.completedSteps?.includes(1) || false,
                        'metadata.draftProgress.fieldCompletion.vehicleRequirements': orderData.metadata.draftProgress.completedSteps?.includes(2) || false,
                        'metadata.draftProgress.fieldCompletion.review': orderData.metadata.draftProgress.completedSteps?.includes(3) || false,

                        updatedAt: new Date()
                    },
                    $push: {
                        orderInstantHistory: {
                            status: 'draft',
                            timestamp: new Date(),
                            updatedBy: {
                                userId: clientId,
                                role: 'client'
                            },
                            notes: 'Order draft saved'
                        }
                    }
                },
                {new: true, runValidators: true}
            );

            if (!order) {
                return res.status(404).json({error: "Order not found"});
            }

            return res.status(200).json({
                message: "Draft order saved successfully",
                order: order.toObject()
            });

        } catch (err) {
            console.log("Save draft error:", err);
            return res.status(500).json({error: "Failed to save draft order"});
        }
    }

    static async updateOrder(req, res) {
        console.log('To be implemented: Update order details');
    }

    static async submitOrder(req, res) {
        console.log('To be implemented: Submit order for processing');
    }

    static async deleteOrder(req, res) {
        const preCheckResult = await AuthController.apiPreCheck(req);
        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {userData} = preCheckResult;
        const clientId = userData._id;
        const {orderId} = req.body;

        try {
            const {Order} = await getOrderModels();
            const order = await Order.findOneAndDelete({_id: orderId, clientId});

            if (!order) {
                return res.status(404).json({error: "Order not found"});
            }

            // Get updated data after deletion
            const {orders, statistics} = await OrderController.getClientOrdersWithStats(clientId);

            return OrderController.successResponse(res, "Order deleted successfully", {
                order: {orders, statistics}
            });

        } catch (err) {
            console.log("Delete order error:", err);
            return res.status(500).json({error: "Failed to delete order"});
        }
    }

    /**
     * Initialize PayStack payment for an order
     * - Generate unique payment reference
     * - Call PayStack API to create transaction
     * - Return authorization URL to client
     */
    static async initiatePayment(req, res) {
        const preCheckResult = await AuthController.apiPreCheck(req);
        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {userData} = preCheckResult;
        const clientId = userData._id;

        const {
            id,
            orderRef,
            amount,
            currency,
            email,
            attemptId
        } = req.body;
        if (!id || !orderRef || !amount || !currency || !email) {
            return res.status(400).json({error: "Missing required payment fields"});
        }
        // Validate amount
        if (typeof amount !== 'number' || amount <= 0 || amount > 10000000) { // Max ₦10M
            return res.status(400).json({
                error: "Invalid payment amount",
                details: "Amount must be between ₦1 and ₦10,000,000"
            });
        }

        // Validate currency
        if (currency !== 'NGN') {
            return res.status(400).json({
                error: "Unsupported currency",
                details: "Only NGN is currently supported"
            });
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({
                error: "Invalid email format"
            });
        }
        try {
            const {Order} = await getOrderModels();

            // Find and validate order
            const order = await Order.findOne({_id: id, clientId}).select('+payment');

            if (!order) {
                return res.status(404).json({
                    error: "Order not found",
                    details: "Order does not exist or you don't have permission to access it"
                });
            }

            // Validate order status
            if (order.status !== ORDER_STATUS.DRAFT) {
                return res.status(400).json({
                    error: "Invalid order status",
                    details: `Only draft orders can be paid for. Current status: ${order.status}`
                });
            }

            // Validate order has valid pricing
            if (!order.pricing || !order.pricing.totalAmount || order.pricing.totalAmount <= 0) {
                return res.status(400).json({
                    error: "Invalid order pricing",
                    details: "Order has no valid pricing information"
                });
            }

            // Ensure payment integrity
            if (Math.abs(amount - order.pricing.totalAmount) > 0.01) { // Allow for minor floating point differences
                return res.status(400).json({
                    error: "Payment amount mismatch",
                    details: `Expected: ₦${order.pricing.totalAmount}, Received: ₦${amount}`
                });
            }

            if (orderRef !== order.orderRef) {
                return res.status(400).json({
                    error: "Order reference mismatch",
                    details: "Order reference does not match"
                });
            }

            // Check for existing pending/processing payment
            if (order.payment &&
                [PAYMENT_STATUS.PROCESSING, PAYMENT_STATUS.PENDING].includes(order.payment.status)) {

                const timeSinceInit = Date.now() - new Date(order.payment.initiatedAt).getTime();
                const COOLDOWN_PERIOD = 30 * 1000;

                // If less than 10 minutes since last initiation, return existing reference
                if (timeSinceInit < COOLDOWN_PERIOD) {
                    const timeToWait = Math.ceil((COOLDOWN_PERIOD - timeSinceInit) / 1000); // Convert to seconds
                    return res.status(409).json({
                        error: "Payment already in progress",
                        details: "A payment is already being processed for this order",
                        reference: order.payment.reference,
                        authorizationUrl: order.payment.metadata?.checkoutUrl,
                        timeToWait: timeToWait, // Time in seconds
                        retryAfter: new Date(Date.now() + (COOLDOWN_PERIOD - timeSinceInit)).toISOString()
                    });
                }
            }

            // Generate idempotency key
            const idempotencyKey = generateIdempotencyKey(order._id, attemptId);

            // Prepare PayStack transaction
            const paymentRef = `${order.orderRef}-${Date.now()}`;
            const callbackUrl = `${process.env.API_BASE_URL}/order/payment-callback?orderId=${order._id}&reference=${paymentRef}`;

            const payStackPayload = {
                email,
                amount: Math.round(amount * 100), // Convert to kobo and ensure integer
                currency: currency.toUpperCase(),
                reference: paymentRef,
                callback_url: callbackUrl,
                metadata: {
                    orderId: order._id.toString(),
                    clientId: clientId.toString(),
                    orderRef: order.orderRef,
                    idempotencyKey,
                    custom_fields: [
                        {
                            display_name: "Order Reference",
                            variable_name: "order_reference",
                            value: order.orderRef
                        }
                    ]
                },
                split_code: process.env.PAYSTACK_SPLIT_CODE || null // For commission splits if configured
            };

            // Initialize payment with PayStack
            console.log('Initializing PayStack payment:', {reference: paymentRef, amount, email});
            const response = await payStackInit(payStackPayload);

            if (!response || !response.status || !response.data) {
                throw new Error('Invalid response from payment service');
            }

            const {authorization_url, access_code, reference: providerRef} = response.data;

            // Update order with payment details
            const paymentUpdate = {
                reference: paymentRef,
                method: 'PayStack',
                status: PAYMENT_STATUS.PROCESSING,
                amount: order.pricing.totalAmount,
                currency: 'NGN',
                initiatedAt: new Date(),
                metadata: {
                    ...(order.payment?.metadata || {}),
                    checkoutUrl: authorization_url,
                    accessCode: access_code,
                    providerReference: providerRef,
                    idempotencyKey,
                    userAgent: req.get('User-Agent'),
                    ipAddress: req.ip || req.connection.remoteAddress
                }
            };

            // Use atomic update to prevent race conditions
            const updatedOrder = await Order.findOneAndUpdate(
                {
                    _id: order._id,
                    clientId,
                    // Ensure status hasn't changed since we last checked
                    status: ORDER_STATUS.DRAFT
                },
                {
                    $set: {
                        payment: paymentUpdate,
                        'metadata.lastPaymentAttempt': new Date()
                    },
                    $push: {
                        orderInstantHistory: {
                            status: 'payment_initiated',
                            timestamp: new Date(),
                            updatedBy: {
                                userId: clientId,
                                role: 'client'
                            },
                            notes: `Payment initiated. Reference: ${paymentRef}`
                        }
                    }
                },
                {
                    new: true,
                    runValidators: true
                }
            );

            if (!updatedOrder) {
                return res.status(409).json({
                    error: "Order status changed",
                    details: "Order status was modified during payment initialization"
                });
            }

            console.log('✅ Payment initialized successfully:', paymentRef);

            return res.status(201).json({
                message: "Payment initiated successfully",
                authorizationUrl: authorization_url,
                accessCode: access_code,
                reference: paymentRef,
                expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString() // 15 minutes
            });


        } catch (error) {
            console.log("Payment initiation error:", error);

            // Categorize errors for better client handling
            if (error.message?.includes('timeout')) {
                return res.status(504).json({
                    error: "Request timeout",
                    details: "Payment service is temporarily slow. Please try again."
                });
            }

            if (error.message?.includes('temporarily unavailable')) {
                return res.status(503).json({
                    error: "Service unavailable",
                    details: "Payment service is temporarily unavailable. Please try again shortly."
                });
            }
            return res.status(500).json({error: "Failed to initiate payment"});
        }
    }

    /**
     * This callback is invoked by PayStack after payment completion
     * Paystack will pass this url to the browser
     * Browser will trigger the url which will then make an api call essentially to this function
     * We then verify the payment and update the order accordingly
     * Upon Success, we return with a deep link url which will trigger the mobile device to close the browser and open the app
     * the App opens to the deep link provided
     * Upon Failure, we return with a deep link url which will trigger the mobile device to close the browser and open the app
     * the App opens to the deep link provided
     * @param req
     * @param res
     */
    static async paystackPaymentCallback(req, res) {
        let {orderId, reference} = req.query;
        // Fix: Handle reference as array
        if (Array.isArray(reference)) {
            reference = reference[0]; // Take first element
        }

        console.log('Payment callback received:', {orderId, reference});

        if (!orderId || !reference) {
            console.log('Missing parameters in callback');
            return res.redirect(`${process.env.APP_DEEP_LINK}://client/orders/payment-status?reason=invalid_parameters`);
        }

        try {
            const {Order} = await getOrderModels();


            const order = await Order.findOne({
                _id: orderId,
                'payment.reference': reference
            }).select('+payment');

            if (!order) {
                console.log('Order not found for callback:', orderId, reference);
                return res.redirect(`${process.env.APP_DEEP_LINK}://client/orders/payment-status?reason=order_not_found&orderId=${orderId}`);
            }

            // Verify payment with PayStack
            try {
                const verification = await verifyPayStackTransaction(reference);
                const verificationData = verification.data;

                if (verificationData.status === 'success') {
                    // Verify amount
                    const paidAmount = verificationData.amount / 100;
                    if (Math.abs(paidAmount - order.payment.amount) > 0.01) {
                        console.log('Callback amount mismatch:', {
                            expected: order.payment.amount,
                            received: paidAmount
                        });
                        return res.redirect(`${process.env.APP_DEEP_LINK}://client/orders/payment-status?orderId=${orderId}&reason=amount_mismatch`);
                    }

                    // Update order if not already updated
                    await Order.findOneAndUpdate(
                        {
                            _id: orderId,
                            'payment.reference': reference,
                            'payment.status': {$ne: PAYMENT_STATUS.PAID}
                        },
                        {
                            $set: {
                                'payment.status': PAYMENT_STATUS.PAID,
                                'payment.paidAt': new Date(),
                                'payment.paystackData': verificationData,
                                'status': ORDER_STATUS.SUBMITTED,
                                'metadata.draftProgress.step': 4,
                                'metadata.draftProgress.fieldCompletion.payment': true,
                                'metadata.draftProgress.completedAt': new Date(),
                                'metadata.draftProgress.lastUpdated': new Date()
                            },
                            $addToSet: {
                                'metadata.draftProgress.completedSteps': 4
                            },
                            $push: {
                                orderInstantHistory: {
                                    status: ORDER_STATUS.CONFIRMED,
                                    timestamp: new Date(),
                                    updatedBy: {
                                        userId: order.clientId,
                                        role: 'system'
                                    },
                                    notes: `Payment confirmed via callback. Reference: ${reference}`
                                },
                                orderTrackingHistory: {
                                    $each: [
                                        {
                                            status: 'order_submitted',
                                            timestamp: new Date(),
                                            title: 'Order Submitted',
                                            description: 'Your order has been submitted and is pending processing.',
                                            icon: "📤",
                                            isCompleted: false,
                                            isCurrent: true,
                                        },
                                        {
                                            status: 'payment_completed',
                                            timestamp: new Date(),
                                            title: 'Payment Completed',
                                            description: 'Your payment was successful via callback. Order is now submitted for processing.',
                                            icon: "✅",
                                            isCompleted: true,
                                            isCurrent: false,
                                        },

                                    ]
                                }
                            }
                        },
                        {
                            new: true,
                        }
                    );
                    // send notification if not existing
                    const [existingOrderNotification, existingPaymentNotification] = await Promise.all([
                        Notification.findOne({
                            userId: order.clientId,
                            category: 'ORDER',
                            type: 'order.created',
                            'metadata.orderId': order._id,
                            'metadata.orderRef': order.orderRef
                        }).lean(),

                        Notification.findOne({
                            userId: order.clientId,
                            category: 'PAYMENT',
                            type: 'payment.successful',
                            'metadata.orderId': order._id,
                            'metadata.gateway': 'PayStack'
                        }).lean()
                    ]);

                    // Create notifications only if they don't exist
                    if (!existingOrderNotification) {
                        await NotificationService.createNotification({
                            userId: order.clientId,
                            type: 'order.created',
                            templateData: {
                                orderId: order.orderRef
                            },
                            metadata: {
                                orderId: order._id,
                                orderRef: order.orderRef,
                            }
                        });
                    }

                    if (!existingPaymentNotification) {
                        await NotificationService.createNotification({
                            userId: order.clientId,
                            type: 'payment.successful',
                            templateData: {
                                amount: verificationData.amount,
                                orderId: order.orderRef
                            },
                            metadata: {
                                orderId: order._id,
                                orderRef: order.orderRef,
                                paymentData: verificationData,
                                gateway: 'PayStack'
                            }
                        });
                    }

                    console.log('✅ Payment successful via callback:', reference);
                    return res.redirect(`${process.env.APP_DEEP_LINK}://client/orders/payment-status?orderId=${orderId}&reference=${reference}`);

                } else {
                    // Payment failed
                    console.log('Payment failed via callback:', verificationData.status);

                    await Order.findOneAndUpdate(
                        {
                            _id: orderId,
                            'payment.reference': reference
                        },
                        {
                            $set: {
                                'payment.status': PAYMENT_STATUS.FAILED,
                                'payment.failureReason': verificationData.gateway_response || 'Payment failed',
                                'payment.failedAt': new Date()
                            }
                        }
                    );
                    const paymentNotification = await Notification.findOne({
                        userId: order.clientId,
                        category: 'PAYMENT',
                        type: 'payment.failed',
                        metadata: {
                            orderId: order._id,
                            orderRef: order.orderRef,
                            gateway: 'PayStack',
                        }
                    });
                    if (!paymentNotification) {
                        await NotificationService.createNotification({
                            userId: order.clientId,
                            type: 'payment.failed',
                            templateData: {
                                amount: order.pricing.totalAmount,
                                orderId: order.orderRef
                            },
                            metadata: {
                                orderId: order._id,
                                orderRef: order.orderRef,
                                totalAmount: order.pricing.totalAmount,
                                status: 'failed',
                                gateway: 'PayStack',
                                reason: verificationData.gateway_response || 'Payment failed',
                            }
                        });
                    }
                    return res.redirect(`${process.env.APP_DEEP_LINK}://client/orders/payment-status?orderId=${orderId}&reason=${encodeURIComponent(verificationData.gateway_response || 'payment_failed')}`);
                }

            } catch
                (verificationError) {
                console.log('Payment verification failed in callback:', verificationError);
                // Send a notification to the user about verification failure
                return res.redirect(`${process.env.APP_DEEP_LINK}://client/orders/payment-status?orderId=${orderId}&reason=verification_failed`);
            }

        } catch (error) {
            console.log('Payment callback error:', error);
            return res.redirect(`${process.env.APP_DEEP_LINK}://client/orders/payment-status?orderId=${orderId}&reason=server_error`);
        }
    }

    /**
     * Check payment status for a given order
     * - Used by frontend to poll for payment completion
     * @param req
     * @param res
     * @returns {Promise<*>}
     */
    static
    async checkPaymentStatus(req, res) {
        const preCheckResult = await AuthController.apiPreCheck(req);
        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {userData} = preCheckResult;
        const clientId = userData._id;
        // check both query params and body for flexibility
        const {reference, orderId} = {...req.query, ...req.body};

        if (!reference || !orderId) {
            return res.status(400).json({
                error: "Missing required parameters",
                details: {
                    reference: !reference ? "Payment reference is required" : null,
                    orderId: !orderId ? "Order ID is required" : null
                }
            });
        }

        try {
            const {Order} = await getOrderModels();

            // Find order with payment details
            const order = await Order.findOne({
                _id: orderId,
                clientId,
                'payment.reference': reference
            }).select('+payment');

            if (!order) {
                return res.status(404).json({
                    error: "Payment not found",
                    details: "No payment found with the provided reference"
                });
            }

            // If already confirmed as paid, return immediately
            if (order.payment.status === PAYMENT_STATUS.PAID) {
                return res.status(200).json({
                    status: 'paid',
                    message: 'Payment confirmed',
                    reference: order.payment.reference,
                    paidAt: order.payment.paidAt,
                    amount: order.payment.amount
                });
            }

            // Verify with PayStack for real-time status
            try {
                console.log('Verifying payment with PayStack:', reference);
                const verification = await verifyPayStackTransaction(reference);

                const verificationData = verification.data;

                if (verificationData.status === 'success') {
                    // Verify amount matches (convert from kobo to naira)
                    const paidAmount = verificationData.amount / 100;

                    if (Math.abs(paidAmount - order.payment.amount) > 0.01) {
                        console.log('Amount verification failed:', {
                            expected: order.payment.amount,
                            received: paidAmount
                        });

                        return res.status(400).json({
                            error: "Payment amount mismatch",
                            details: "Verified amount does not match order total"
                        });
                    }

                    // Update order status atomically
                    // new: update metadata,
                    const updatedOrder = await Order.findOneAndUpdate(
                        {
                            _id: orderId,
                            'payment.reference': reference,
                            'payment.status': {$ne: PAYMENT_STATUS.PAID} // Prevent duplicate updates
                        },
                        {
                            $set: {
                                'payment.status': PAYMENT_STATUS.PAID,
                                'payment.paidAt': new Date(),
                                'payment.paystackData': verificationData,
                                'status': ORDER_STATUS.CONFIRMED,
                                'metadata.draftProgress.step': 4,
                                'metadata.draftProgress.fieldCompletion.payment': true,
                                'metadata.draftProgress.completedAt': new Date(),
                                'metadata.draftProgress.lastUpdated': new Date()
                            },
                            $addToSet: {
                                'metadata.draftProgress.completedSteps': 4
                            },
                            $push: {
                                orderInstantHistory: {
                                    status: ORDER_STATUS.CONFIRMED,
                                    timestamp: new Date(),
                                    updatedBy: {
                                        userId: clientId,
                                        role: 'system'
                                    },
                                    notes: `Payment confirmed via PayStack. Reference: ${reference}, Amount: ₦${paidAmount}`
                                },
                                orderTrackingHistory: {
                                    $each: [
                                        {
                                            status: 'order_submitted',
                                            timestamp: new Date(),
                                            title: 'Order Submitted',
                                            description: 'Your order has been submitted and is pending processing.',
                                            icon: "📤",
                                            isCompleted: false,
                                            isCurrent: true,
                                        },
                                        {
                                            status: 'payment_completed',
                                            timestamp: new Date(),
                                            title: 'Payment Completed',
                                            description: 'Your payment was successful via Paystack. Order is now submitted for processing.',
                                            icon: "✅",
                                            isCompleted: true,
                                            isCurrent: false,
                                        }
                                    ]
                                }
                            }
                        },
                        {
                            new: true,
                        }
                    );

                    if (updatedOrder) {
                        console.log('✅ Payment confirmed and order updated:', reference);
                        // Send notification if not already sent
                        const [existingOrderNotification, existingPaymentNotification] = await Promise.all([
                            Notification.findOne({
                                userId: order.clientId,
                                category: 'ORDER',
                                type: 'order.created',
                                'metadata.orderId': order._id,
                                'metadata.orderRef': order.orderRef
                            }).lean(),

                            Notification.findOne({
                                userId: order.clientId,
                                category: 'PAYMENT',
                                type: 'payment.successful',
                                'metadata.orderId': order._id,
                                'metadata.gateway': 'PayStack'
                            }).lean()
                        ]);

                        // Create notifications only if they don't exist
                        if (!existingOrderNotification) {
                            await NotificationService.createNotification({
                                userId: order.clientId,
                                type: 'order.created',
                                templateData: {
                                    orderId: order.orderRef
                                },
                                metadata: {
                                    orderId: order._id,
                                    orderRef: order.orderRef,
                                }
                            });
                        }

                        if (!existingPaymentNotification) {
                            await NotificationService.createNotification({
                                userId: order.clientId,
                                type: 'payment.successful',
                                templateData: {
                                    amount: verificationData.amount,
                                    orderId: order.orderRef
                                },
                                metadata: {
                                    orderId: order._id,
                                    orderRef: order.orderRef,
                                    paymentData: verificationData,
                                    gateway: 'PayStack'
                                }
                            });
                        }

                        console.log('✅ Order created notification sent');

                        return res.status(200).json({
                            status: 'paid',
                            message: 'Payment confirmed successfully',
                            reference: reference,
                            paidAt: updatedOrder.payment.paidAt,
                            amount: updatedOrder.payment.amount,
                            orderId: updatedOrder._id
                        });
                    } else {
                        // Order was already updated by another process
                        return res.status(200).json({
                            status: 'paid',
                            message: 'Payment already confirmed',
                            reference: reference
                        });
                    }

                } else if (verificationData.status === 'failed' || verificationData.status === 'abandoned') {
                    // Update payment as failed
                    await Order.findOneAndUpdate(
                        {
                            _id: orderId,
                            'payment.reference': reference
                        },
                        {
                            $set: {
                                'payment.status': PAYMENT_STATUS.FAILED,
                                'payment.failureReason': verificationData.gateway_response || 'Payment failed',
                                'payment.failedAt': new Date()
                            }
                        }
                    );

                    return res.status(200).json({
                        status: 'failed',
                        message: verificationData.gateway_response || 'Payment failed',
                        reference: reference
                    });

                } else {
                    // Payment still pending/processing
                    return res.status(200).json({
                        status: 'processing',
                        message: 'Payment is still being processed',
                        reference: reference
                    });
                }

            } catch (verificationError) {
                console.log('PayStack verification failed:', verificationError);

                // Return current order status instead of failing
                return res.status(200).json({
                    status: order.payment.status,
                    message: 'Unable to verify with payment provider, returning cached status',
                    reference: reference,
                    cached: true
                });
            }

        } catch (error) {
            console.log("Payment status check error:", error);
            return res.status(500).json({
                error: "Failed to check payment status",
                details: process.env.NODE_ENV === 'development' ? error.message : "Internal server error"
            });
        }
    }

    /**
     * Enhanced PayStack webhook handler with signature verification
     */
    static
    async paystackWebhook(req, res) {
        const signature = req.get('x-paystack-signature');
        let body = req.body;
        if (typeof body !== 'string') {
            body = JSON.stringify(body);
        }

        // Verify webhook signature is from PayStack
        if (!signature || !verifyWebhookSignature(body, signature)) {
            console.log('Invalid webhook signature');
            return res.status(401).json({error: 'Invalid signature'});
        }

        const parsedBody = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const {event, data} = parsedBody;
        console.log('Webhook received:', {event, reference: data?.reference});

        try {
            switch (event) {
                case 'charge.success':
                    await OrderController.handleSuccessfulCharge(data);
                    break;

                case 'charge.failed':
                    await OrderController.handleFailedCharge(data);
                    break;

                case 'transfer.success':
                case 'transfer.failed':
                    await OrderController.handleTransferEvent(event, data);
                    break;

                default:
                    console.log(`Unhandled webhook event: ${event}`);
            }

            return res.status(200).json({message: 'Webhook processed'});

        } catch (error) {
            console.log('Webhook processing error:', error);
            return res.status(500).json({error: 'Webhook processing failed'});
        }
    }

    static
    async handleTransferEvent(event, data) {
        const {reference, amount, status, reason} = data;

        try {
            const {Order} = await getOrderModels();

            // Find order by transfer reference
            const order = await Order.findOne({
                'payment.transferReference': reference
            });

            if (!order) {
                console.log('Order not found for transfer webhook:', reference);
                return;
            }

            // Update order payment transfer status
            await Order.findOneAndUpdate(
                {_id: order._id, 'payment.transferReference': reference},
                {
                    $set: {
                        'payment.transferStatus': status,
                        'payment.transferAmount': amount / 100, // Convert from kobo
                        'payment.transferUpdatedAt': new Date(),
                        ...(status === 'failed' && {'payment.transferFailureReason': reason})
                    },
                    $push: {
                        orderInstantHistory: {
                            status: `transfer_${status}`,
                            timestamp: new Date(),
                            updatedBy: {
                                userId: order.clientId,
                                role: 'system'
                            },
                            notes: `Transfer ${status} via webhook. Reference: ${reference}` + (status === 'failed' ? `, Reason: ${reason}` : '')
                        }
                    }
                }
            );

            console.log(`✅ Transfer ${status} updated via webhook:`, reference);

        } catch (error) {
            console.log('Error handling transfer event:', error);
        }
    }

    /**
     * Handle successful charge webhook
     */
    static
    async handleSuccessfulCharge(data) {
        const {reference, amount, customer, metadata} = data;

        try {
            const {Order} = await getOrderModels();

            const order = await Order.findOne({
                'payment.reference': reference
            });

            if (!order) {
                console.log('Order not found for webhook:', reference);
                return;
            }

            // Prevent duplicate processing
            if (order.payment.status === PAYMENT_STATUS.PAID) {
                console.log('Order already marked as paid:', reference);
                return;
            }

            // Verify amount
            const paidAmount = amount / 100; // Convert from kobo
            if (Math.abs(paidAmount - order.payment.amount) > 0.01) {
                console.log('Webhook amount mismatch:', {
                    expected: order.payment.amount,
                    received: paidAmount,
                    reference
                });
                return;
            }

            // Update order
            await Order.findOneAndUpdate(
                {
                    _id: order._id,
                    'payment.reference': reference,
                    'payment.status': {$ne: PAYMENT_STATUS.PAID}
                },
                {
                    $set: {
                        'payment.status': PAYMENT_STATUS.PAID,
                        'payment.paidAt': new Date(),
                        'payment.webhookData': data,
                        'status': ORDER_STATUS.CONFIRMED,
                        'metadata.draftProgress.step': 4,
                        'metadata.draftProgress.fieldCompletion.payment': true,
                        'metadata.draftProgress.completedAt': new Date(),
                        'metadata.draftProgress.lastUpdated': new Date(),
                    },
                    $addToSet: {
                        'metadata.draftProgress.completedSteps': 4
                    },
                    $push: {
                        orderInstantHistory: {
                            status: ORDER_STATUS.CONFIRMED,
                            timestamp: new Date(),
                            updatedBy: {
                                userId: order.clientId,
                                role: 'system'
                            },
                            notes: `Payment confirmed via webhook. Reference: ${reference}`
                        },
                        orderTrackingHistory: {
                            $each: [
                                {
                                    status: 'order_submitted',
                                    timestamp: new Date(),
                                    title: 'Order Submitted',
                                    description: 'Your order has been submitted and is pending processing.',
                                    icon: "📤",
                                    isCompleted: false,
                                    isCurrent: true,
                                },
                                {
                                    status: 'payment_completed',
                                    timestamp: new Date(),
                                    title: 'Payment Completed',
                                    description: 'Your payment was successful via Paystack. Order is now submitted for processing.',
                                    icon: "✅",
                                    isCompleted: true,
                                    isCurrent: false,
                                }
                            ]
                        }
                    }
                },
            );

            console.log('✅ Order updated via webhook:', reference);

        } catch (error) {
            console.log('Error handling successful charge:', error);
        }
    }

    /**
     * Handle failed charge webhook
     */
    static
    async handleFailedCharge(data) {
        const {reference, gateway_response} = data;

        try {
            const {Order} = await getOrderModels();

            await Order.findOneAndUpdate(
                {'payment.reference': reference},
                {
                    $set: {
                        'payment.status': PAYMENT_STATUS.FAILED,
                        'payment.failureReason': gateway_response,
                        'payment.failedAt': new Date(),
                        'payment.webhookData': data
                    }
                }
            );

            console.log('Payment marked as failed via webhook:', reference);

        } catch (error) {
            console.log('Error handling failed charge:', error);
        }
    }

    /**
     * Refund payment (for cancellations)
     */
    static
    async refundPayment(req, res) {
        const preCheckResult = await AuthController.apiPreCheck(req);
        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {orderId, reason} = req.body;
        const {userData} = preCheckResult;

        if (!orderId || !reason) {
            return res.status(400).json({
                error: "Missing required parameters",
                details: "Order ID and refund reason are required"
            });
        }

        try {
            const {Order} = await getOrderModels();

            const order = await Order.findOne({
                _id: orderId,
                clientId: userData._id,
                'payment.status': PAYMENT_STATUS.PAID
            });

            if (!order) {
                return res.status(404).json({
                    error: "Order not found or not eligible for refund"
                });
            }

            // Check if refund is allowed (e.g., within refund window)
            const hoursSincePaid = (Date.now() - new Date(order.payment.paidAt).getTime()) / (1000 * 60 * 60);
            if (hoursSincePaid > 24) { // 24 hour refund window
                return res.status(400).json({
                    error: "Refund window expired",
                    details: "Refunds are only allowed within 24 hours of payment"
                });
            }

            // TODO: Implement PayStack refund API call
            // For now, mark as refund requested
            await Order.findOneAndUpdate(
                {_id: orderId},
                {
                    $set: {
                        'payment.status': 'refund_requested',
                        'payment.refundReason': reason,
                        'payment.refundRequestedAt': new Date()
                    },
                    $push: {
                        orderInstantHistory: {
                            status: 'refund_requested',
                            timestamp: new Date(),
                            updatedBy: {
                                userId: userData._id,
                                role: 'client'
                            },
                            notes: `Refund requested: ${reason}`
                        }
                    }
                }
            );

            return res.status(200).json({
                message: "Refund request submitted successfully",
                details: "Your refund request will be processed within 3-5 business days"
            });

        } catch (error) {
            console.log("Refund request error:", error);
            return res.status(500).json({
                error: "Failed to process refund request"
            });
        }
    }

    /**
     * Common function to get orders and statistics for a client
     */
    static
    async getClientOrdersWithStats(clientId) {
        const {Order} = await getOrderModels();

        const orders = await Order.find({clientId})
            .sort({createdAt: -1})
            .lean();

        const results = await Order.aggregate([
            {$match: {clientId: new mongoose.Types.ObjectId(clientId)}},
            {
                $group: {
                    _id: null,
                    total: {$sum: 1},
                    completed: {
                        $sum: {$cond: [{$eq: ["$status", "delivered"]}, 1, 0]}
                    },
                    active: {
                        $sum: {
                            $cond: [
                                {
                                    $in: ["$status", [
                                        "draft", "pending", "broadcast", "assigned", "confirmed",
                                        "en_route_pickup", "arrived_pickup", "picked_up", "in_transit", "arrived_dropoff"
                                    ]]
                                },
                                1,
                                0
                            ]
                        }
                    },
                    failed: {
                        $sum: {
                            $cond: [
                                {$in: ["$status", ["cancelled", "failed", "returned"]]},
                                1,
                                0
                            ]
                        }
                    }
                }
            }
        ]);

        return {
            orders,
            statistics: results[0] || {
                total: 0,
                completed: 0,
                active: 0,
                failed: 0
            }
        };
    }

    /**
     * Common success response format
     */
    static successResponse(res, message, data = {}) {
        return res.status(200).json({message, ...data});
    }
}

/**
 * Generate a unique delivery token for S3 uploads
 */
function

generateDeliveryToken() {
    const crypto = require('crypto');
    return crypto.randomBytes(3).toString('hex').toUpperCase();
}

async function

payStackInit(payload) {
    try {
        const response = await axios({
            method: "POST",
            url,
            headers: {
                Authorization: `Bearer ${secret}`,
                "Content-Type": "application/json",
            },
            data: payload,
            timeout: 10000 // 10 seconds timeout
        });
        return response.data;
    } catch (error) {
        console.log("Order initialization error:", error);
        throw new Error("Failed to initialize order");
    }
}

module
    .exports = OrderController;
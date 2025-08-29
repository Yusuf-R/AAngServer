import AuthController from "./AuthController";
import getOrderModels, {generateOrderRef} from "../models/Order";
import getModels from "../models/AAng/AAngLogistics";
import mongoose from "mongoose";
import { calculateTotalPrice } from "../utils/LogisticPricingEngine";

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
            const { Order } = await getOrderModels();
            const { AAngBase, Client, Driver } = await getModels();

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
                    method: 'wallet'
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

                statusHistory: [{
                    status: 'draft',
                    timestamp: new Date(),
                    updatedBy: {
                        userId: clientId,
                        role: 'client'
                    },
                    notes: 'Draft order instantiated for form completion'
                }]
            });


            await draftOrder.save();

            const orderData = draftOrder.toObject();

            // Fetch all orders for the client
            const orders = await Order.find({ clientId }).sort({ createdAt: -1 });


            // Compute statistics via aggregation
            const results = await Order.aggregate([
                { $match: { clientId: new mongoose.Types.ObjectId(clientId) } },
                {
                    $group: {
                        _id: null,
                        total: { $sum: 1 },
                        completed: {
                            $sum: { $cond: [{ $eq: ["$status", "delivered"] }, 1, 0] }
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
                                    { $in: ["$status", ["cancelled", "failed", "returned"]] },
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
            console.error("Draft order creation error:", err);
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
            const { Order } = await getOrderModels();
            const orderData = req.body;

            // Validate required fields
            if (!orderData.pickup || !orderData.dropoff || !orderData.package) {
                return res.status(400).json({ error: "Missing required order fields" });
            }

            // Create new order instance
            const newOrder = new Order({
                ...orderData,
                clientId,
                orderRef: generateOrderRef(),
                status: 'draft',
                deliveryToken: generateDeliveryToken(),
                statusHistory: [{
                    status: 'draft',
                    timestamp: new Date(),
                    updatedBy: {
                        userId: clientId,
                        role: 'client'
                    },
                    notes: 'Order created and saved as draft'
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
            const orders = await Order.find({ clientId }).sort({ createdAt: -1 });

            // Compute statistics via aggregation
            const results = await Order.aggregate([
                { $match: { clientId: new mongoose.Types.ObjectId(clientId) } },
                {
                    $group: {
                        _id: null,
                        total: { $sum: 1 },
                        completed: {
                            $sum: { $cond: [{ $eq: ["$status", "delivered"] }, 1, 0] }
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
                                    { $in: ["$status", ["cancelled", "failed", "returned"]] },
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
            console.error("Create order error:", err);
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
            const { Order } = await getOrderModels();
            const orders = await Order.find({ clientId }).sort({ createdAt: -1 });

            // Compute statistics using aggregation
            const results = await Order.aggregate([
                { $match: { clientId: new mongoose.Types.ObjectId(clientId) } },
                {
                    $group: {
                        _id: null,
                        total: { $sum: 1 },
                        completed: {
                            $sum: { $cond: [{ $eq: ["$status", "delivered"] }, 1, 0] }
                        },
                        active: {
                            $sum: {
                                $cond: [
                                    { $in: ["$status", [
                                            "draft", "pending", "broadcast", "assigned", "confirmed",
                                            "en_route_pickup", "arrived_pickup", "picked_up", "in_transit", "arrived_dropoff"
                                        ]]},
                                    1,
                                    0
                                ]
                            }
                        },
                        failed: {
                            $sum: {
                                $cond: [
                                    { $in: ["$status", ["cancelled", "failed", "returned"]] },
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
            console.error("Get all client orders error:", err);
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

        console.log({
            orderData
        })

        // Add this after extracting orderData and before the try block
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
                    weight: orderData.package?.weight || { value: 1, unit: 'kg' },
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

            console.log({
                backendPricing,
                backendTotal,
                pricingInput
            })
            // Security check - compare totals
            const tolerance = Math.max(1, Math.round(frontendTotal * 0.001)); // 0.1% or minimum 1 NGN
            if (Math.abs(frontendTotal - backendTotal) > tolerance) {
                console.error('Pricing mismatch:', {
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
            const { Order } = await getOrderModels();
            const order = await Order.findOneAndUpdate(
                { _id: orderData._id, clientId },
                {
                    ...orderData,
                    updatedAt: new Date(),
                    statusHistory: [
                        ...orderData.statusHistory,
                        {
                            status: 'draft',
                            timestamp: new Date(),
                            updatedBy: {
                                userId: clientId,
                                role: 'client'
                            },
                            notes: 'Order draft saved'
                        }
                    ]
                },
                { new: true, runValidators: true }
            );

            if (!order) {
                return res.status(404).json({ error: "Order not found" });
            }

            return res.status(200).json({
                message: "Draft order saved successfully",
                order: order.toObject()
            });

        } catch (err) {
            console.error("Save draft error:", err);
            return res.status(500).json({ error: "Failed to save draft order" });
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
        const { orderId } = req.body;

        try {
            const { Order } = await getOrderModels();
            const order = await Order.findOneAndDelete({ _id: orderId, clientId });

            if (!order) {
                return res.status(404).json({ error: "Order not found" });
            }

            // Get updated data after deletion
            const { orders, statistics } = await OrderController.getClientOrdersWithStats(clientId);

            return OrderController.successResponse(res, "Order deleted successfully", {
                order: { orders, statistics }
            });

        } catch (err) {
            console.error("Delete order error:", err);
            return res.status(500).json({ error: "Failed to delete order" });
        }
    }

    /**
     * Common function to get orders and statistics for a client
     */
    static async getClientOrdersWithStats(clientId) {
        const { Order } = await getOrderModels();

        const orders = await Order.find({ clientId })
            .sort({ createdAt: -1 })
            .lean();

        const results = await Order.aggregate([
            { $match: { clientId: new mongoose.Types.ObjectId(clientId) } },
            {
                $group: {
                    _id: null,
                    total: { $sum: 1 },
                    completed: {
                        $sum: { $cond: [{ $eq: ["$status", "delivered"] }, 1, 0] }
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
                                { $in: ["$status", ["cancelled", "failed", "returned"]] },
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
        return res.status(200).json({ message, ...data });
    }
}

/**
 * Generate a unique delivery token for S3 uploads
 */
function generateDeliveryToken() {
    const crypto = require('crypto');
    return crypto.randomBytes(16).toString('hex');
}

module.exports = OrderController;
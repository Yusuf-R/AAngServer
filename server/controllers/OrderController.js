// /controllers/OrderController.js
import OrderService from '../services/OrderService.js';

class OrderController {
    constructor() {
        this.orderService = new OrderService();
    }

    // Create a new order
    createOrder = async (req, res) => {
        try {
            const { body } = req;
            const clientId = req.user.id; // Assuming user ID is available from auth middleware

            // Validate required fields
            const requiredFields = ['pickup', 'dropoff', 'package', 'payment'];
            const missingFields = requiredFields.filter(field => !body[field]);

            if (missingFields.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Missing required fields',
                    missingFields
                });
            }

            // Validate coordinates
            if (!this.validateCoordinates(body.pickup.coordinates) ||
                !this.validateCoordinates(body.dropoff.coordinates)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid pickup or dropoff coordinates'
                });
            }

            const result = await this.orderService.createOrder(body, clientId);

            if (result.success) {
                res.status(201).json({
                    success: true,
                    message: result.message,
                    data: {
                        order: result.order
                    }
                });
            } else {
                res.status(400).json({
                    success: false,
                    message: result.error
                });
            }

        } catch (error) {
            console.error('Error in createOrder controller:', error);
            res.status(500).json({
                success: false,
                message: 'Internal server error',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    };

    // Get order by ID
    getOrder = async (req, res) => {
        try {
            const { orderId } = req.params;
            const userId = req.user.id;
            const userRole = req.user.role;

            const order = await this.orderService.getOrderById(orderId);

            if (!order) {
                return res.status(404).json({
                    success: false,
                    message: 'Order not found'
                });
            }

            // Check if user has permission to view this order
            const hasPermission =
                userRole === 'Admin' ||
                order.clientId._id.toString() === userId ||
                (order.tracking && order.tracking.driverId && order.tracking.driverId._id.toString() === userId);

            if (!hasPermission) {
                return res.status(403).json({
                    success: false,
                    message: 'Not authorized to view this order'
                });
            }

            res.json({
                success: true,
                data: { order }
            });

        } catch (error) {
            console.error('Error in getOrder controller:', error);
            res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    };

    // Get client orders
    getClientOrders = async (req, res) => {
        try {
            const clientId = req.user.id;
            const { page = 1, limit = 20, status } = req.query;

            const result = await this.orderService.getClientOrders(
                clientId,
                parseInt(page),
                parseInt(limit),
                status
            );

            res.json({
                success: true,
                data: result
            });

        } catch (error) {
            console.error('Error in getClientOrders controller:', error);
            res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    };

    // Get driver orders
    getDriverOrders = async (req, res) => {
        try {
            const driverId = req.user.id;
            const { page = 1, limit = 20 } = req.query;

            const result = await this.orderService.getDriverOrders(
                driverId,
                parseInt(page),
                parseInt(limit)
            );

            res.json({
                success: true,
                data: result
            });

        } catch (error) {
            console.error('Error in getDriverOrders controller:', error);
            res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    };

    // Get available orders for driver
    getAvailableOrders = async (req, res) => {
        try {
            const driverId = req.user.id;
            const { lat, lng, radius = 10000 } = req.query;

            if (!lat || !lng) {
                return res.status(400).json({
                    success: false,
                    message: 'Driver location (lat, lng) is required'
                });
            }

            const result = await this.orderService.getAvailableOrdersForDriver(
                driverId,
                parseFloat(lat),
                parseFloat(lng),
                parseInt(radius)
            );

            res.json(result);

        } catch (error) {
            console.error('Error in getAvailableOrders controller:', error);
            res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    };

    // Driver responds to order assignment
    respondToOrder = async (req, res) => {
        try {
            const { orderId } = req.params;
            const { response, rejectionReason } = req.body;
            const driverId = req.user.id;

            if (!['accepted', 'rejected'].includes(response)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid response. Must be "accepted" or "rejected"'
                });
            }

            if (response === 'rejected' && !rejectionReason) {
                return res.status(400).json({
                    success: false,
                    message: 'Rejection reason is required when rejecting an order'
                });
            }

            const result = await this.orderService.handleDriverResponse(
                orderId,
                driverId,
                response,
                rejectionReason
            );

            if (result.success) {
                res.json({
                    success: true,
                    message: result.message
                });
            } else {
                res.status(400).json({
                    success: false,
                    message: result.message
                });
            }

        } catch (error) {
            console.error('Error in respondToOrder controller:', error);
            res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    };

    // Update order status
    updateOrderStatus = async (req, res) => {
        try {
            const { orderId } = req.params;
            const { status, notes, photos, signature } = req.body;
            const userId = req.user.id;
            const userRole = req.user.role;

            // Validate status
            const validStatuses = [
                'confirmed', 'en_route_pickup', 'arrived_pickup',
                'picked_up', 'in_transit', 'arrived_dropoff', 'delivered'
            ];

            if (!validStatuses.includes(status)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid status'
                });
            }

            // Check if user can update this order
            const order = await this.orderService.getOrderById(orderId);
            if (!order) {
                return res.status(404).json({
                    success: false,
                    message: 'Order not found'
                });
            }

            const canUpdate =
                userRole === 'Admin' ||
                (order.tracking && order.tracking.driverId && order.tracking.driverId._id.toString() === userId);

            if (!canUpdate) {
                return res.status(403).json({
                    success: false,
                    message: 'Not authorized to update this order'
                });
            }

            const updateInfo = {
                notes,
                photos,
                signature,
                updatedBy: {
                    userId,
                    role: userRole.toLowerCase()
                }
            };

            const updatedOrder = await this.orderService.updateOrderStatus(orderId, status, updateInfo);

            res.json({
                success: true,
                message: 'Order status updated successfully',
                data: { order: updatedOrder }
            });

        } catch (error) {
            console.error('Error in updateOrderStatus controller:', error);
            res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    };

    // Update order location (for real-time tracking)
    updateLocation = async (req, res) => {
        try {
            const { orderId } = req.params;
            const { lat, lng } = req.body;
            const driverId = req.user.id;

            if (!lat || !lng) {
                return res.status(400).json({
                    success: false,
                    message: 'Latitude and longitude are required'
                });
            }

            const result = await this.orderService.updateOrderLocation(orderId, lat, lng, driverId);

            if (result) {
                res.json({
                    success: true,
                    message: 'Location updated successfully'
                });
            } else {
                res.status(400).json({
                    success: false,
                    message: 'Failed to update location'
                });
            }

        } catch (error) {
            console.error('Error in updateLocation controller:', error);
            res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    };

    // Cancel order
    cancelOrder = async (req, res) => {
        try {
            const { orderId } = req.params;
            const { reason } = req.body;
            const userId = req.user.id;

            if (!reason) {
                return res.status(400).json({
                    success: false,
                    message: 'Cancellation reason is required'
                });
            }

            const result = await this.orderService.cancelOrder(orderId, userId, reason);

            if (result.success) {
                res.json({
                    success: true,
                    message: result.message,
                    data: {
                        cancellationFee: result.cancellationFee
                    }
                });
            } else {
                res.status(400).json({
                    success: false,
                    message: result.message
                });
            }

        } catch (error) {
            console.error('Error in cancelOrder controller:', error);
            res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    };

    // Rate order
    rateOrder = async (req, res) => {
        try {
            const { orderId } = req.params;
            const { stars, feedback } = req.body;
            const userId = req.user.id;
            const userRole = req.user.role;

            if (!stars || stars < 1 || stars > 5) {
                return res.status(400).json({
                    success: false,
                    message: 'Rating must be between 1 and 5 stars'
                });
            }

            const ratingData = {
                stars: parseInt(stars),
                feedback,
                raterType: userRole === 'Client' ? 'client' : 'driver'
            };

            const result = await this.orderService.rateOrder(orderId, ratingData, userId);

            if (result.success) {
                res.json({
                    success: true,
                    message: result.message
                });
            } else {
                res.status(400).json({
                    success: false,
                    message: result.message
                });
            }

        } catch (error) {
            console.error('Error in rateOrder controller:', error);
            res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    };

    // Get order analytics (Admin only)
    getOrderAnalytics = async (req, res) => {
        try {
            const { timeframe = '7d' } = req.query;

            // Check admin permission
            if (req.user.role !== 'Admin') {
                return res.status(403).json({
                    success: false,
                    message: 'Admin access required'
                });
            }

            const result = await this.orderService.getOrderAnalytics(timeframe);

            res.json(result);

        } catch (error) {
            console.error('Error in getOrderAnalytics controller:', error);
            res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    };

    // Calculate order pricing
    calculatePricing = async (req, res) => {
        try {
            const { pickup, dropoff, package: pkg, priority, vehicleRequirements } = req.body;

            if (!pickup || !dropoff || !pkg) {
                return res.status(400).json({
                    success: false,
                    message: 'Pickup, dropoff, and package information are required'
                });
            }

            const orderData = {
                pickup,
                dropoff,
                package: pkg,
                priority: priority || 'normal',
                vehicleRequirements: vehicleRequirements || ['bicycle', 'motorcycle']
            };

            const pricing = await this.orderService.calculatePricing(orderData);

            res.json({
                success: true,
                data: { pricing }
            });

        } catch (error) {
            console.error('Error in calculatePricing controller:', error);
            res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    };

    // Helper method to validate coordinates
    validateCoordinates = (coordinates) => {
        if (!coordinates || typeof coordinates !== 'object') return false;

        const { lat, lng } = coordinates;

        return (
            typeof lat === 'number' &&
            typeof lng === 'number' &&
            lat >= -90 && lat <= 90 &&
            lng >= -180 && lng <= 180
        );
    };
}

export default OrderController;
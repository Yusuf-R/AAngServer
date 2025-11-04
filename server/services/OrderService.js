// /services/OrderService.js
import getOrderModels, {generateOrderRef} from '../models/Order';
import getModels from '../models/AAng/AAngLogistics.js';

class OrderService {
    constructor() {
        this.initializeModels();
    }

    async initializeModels() {
        const { Order, OrderAssignment } = await getOrderModels();
        const { AAngBase, Client, Driver } = await getModels();

        this.Order = Order;
        this.OrderAssignment = OrderAssignment;
        this.Client = Client;
        this.Driver = Driver;
        this.AAngBase = AAngBase;
    }

    // Create a new order
    async createOrder(orderData, clientId) {
        try {
            // Validate client exists
            const client = await this.Client.findById(clientId);
            if (!client) {
                throw new Error('Client not found');
            }

            // Calculate pricing
            const pricing = await this.calculatePricing(orderData);

            // Create order object
            const orderObj = {
                ...orderData,
                clientId,
                orderRef: generateOrderRef(),
                pricing,
                status: 'pending',
                statusHistory: [{
                    status: 'pending',
                    timestamp: new Date(),
                    updatedBy: {
                        userId: clientId,
                        role: 'client'
                    },
                    notes: 'Order created'
                }]
            };

            const order = new this.Order(orderObj);
            await order.save();

            // If it's an instant order, start the assignment process
            if (orderData.orderType === 'instant') {
                await this.initiateDriverAssignment(order._id);
            }

            return {
                success: true,
                order: await this.getOrderById(order._id),
                message: 'Order created successfully'
            };

        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    // Calculate pricing based on various factors
    async calculatePricing(orderData) {
        const { pickup, dropoff, package: pkg, priority, vehicleRequirements } = orderData;

        // Base pricing logic - you can enhance this based on your business rules
        let baseFare = 500; // Base fare in NGN

        // Calculate distance (simplified - you might want to use a real distance API)
        const distance = this.calculateDistance(
            pickup.coordinates.lat, pickup.coordinates.lng,
            dropoff.coordinates.lat, dropoff.coordinates.lng
        );

        let distanceFare = distance * 50; // 50 NGN per km

        // Weight and size factors
        let weightFare = 0;
        if (pkg.weight && pkg.weight.value > 5) {
            weightFare = (pkg.weight.value - 5) * 20;
        }

        // Priority surcharge
        let priorityFare = 0;
        switch (priority) {
            case 'high':
                priorityFare = baseFare * 0.5;
                break;
            case 'urgent':
                priorityFare = baseFare * 1.0;
                break;
        }

        // Vehicle type surcharge
        let vehicleSurcharge = 0;
        if (vehicleRequirements.includes('van') || vehicleRequirements.includes('truck')) {
            vehicleSurcharge = 200;
        }

        const totalAmount = baseFare + distanceFare + weightFare + priorityFare + vehicleSurcharge;

        return {
            baseFare,
            distanceFare: Math.round(distanceFare),
            weightFare,
            priorityFare,
            surcharges: vehicleSurcharge > 0 ? [{ type: 'vehicle', amount: vehicleSurcharge, reason: 'Special vehicle required' }] : [],
            totalAmount: Math.round(totalAmount),
            currency: 'NGN'
        };
    }

    // Initiate driver assignment process
    async initiateDriverAssignment(orderId) {
        try {
            const order = await this.Order.findById(orderId);
            if (!order) {
                throw new Error('Order not found');
            }

            // Find available drivers within radius
            const availableDrivers = await this.findAvailableDrivers(
                order.pickup.coordinates.lat,
                order.pickup.coordinates.lng,
                order.vehicleRequirements
            );

            if (availableDrivers.length === 0) {
                // Update order status to failed assignment
                await this.updateOrderStatus(orderId, 'failed', {
                    notes: 'No available drivers found',
                    updatedBy: { userId: null, role: 'system' }
                });
                return;
            }

            // Create assignment record
            const assignment = new this.OrderAssignment({
                orderId,
                availableDrivers: availableDrivers.map(driver => ({
                    driverId: driver._id,
                    distance: driver.distance,
                    estimatedArrival: driver.estimatedArrival
                })),
                broadcastRadius: 5000,
                maxDrivers: Math.min(10, availableDrivers.length)
            });

            await assignment.save();

            // Update order status to broadcast
            await this.updateOrderStatus(orderId, 'broadcast', {
                notes: `Broadcasting to ${availableDrivers.length} available drivers`,
                updatedBy: { userId: null, role: 'system' }
            });

            // Send notifications to drivers (implement your notification service)
            await this.notifyDrivers(availableDrivers, order);

            // Set timeout for assignment
            setTimeout(async () => {
                await this.handleAssignmentTimeout(orderId);
            }, 300000); // 5 minutes

            return assignment;

        } catch (error) {
            console.error('Error initiating driver assignment:', error);
            throw error;
        }
    }

    // Find available drivers near pickup location
    async findAvailableDrivers(lat, lng, vehicleRequirements, radius = 5000) {
        try {
            // Find drivers who are online and have the required vehicle type
            const drivers = await this.Driver.find({
                availabilityStatus: 'online',
                vehicleType: { $in: vehicleRequirements },
                status: 'Active'
            }).limit(20);

            // Filter by distance and calculate estimated arrival (simplified)
            const availableDrivers = drivers
                .map(driver => {
                    // In a real app, you'd get driver's current location from a real-time system
                    // For now, assuming driver location is stored somewhere
                    const distance = this.calculateDistance(lat, lng, driver.lat || lat, driver.lng || lng);

                    if (distance <= radius / 1000) { // Convert to km
                        return {
                            ...driver.toObject(),
                            distance,
                            estimatedArrival: Math.round(distance / 30 * 60) // Assuming 30 km/h average speed
                        };
                    }
                    return null;
                })
                .filter(Boolean)
                .sort((a, b) => a.distance - b.distance);

            return availableDrivers;

        } catch (error) {
            console.error('Error finding available drivers:', error);
            return [];
        }
    }

    // Handle driver response to order assignment
    async handleDriverResponse(orderId, driverId, response, rejectionReason = null) {
        try {
            const assignment = await this.OrderAssignment.findOne({ orderId, status: 'broadcasting' });
            if (!assignment) {
                return { success: false, message: 'Assignment not found or already completed' };
            }

            // Update driver response
            const driverIndex = assignment.availableDrivers.findIndex(
                d => d.driverId.toString() === driverId.toString()
            );

            if (driverIndex === -1) {
                return { success: false, message: 'Driver not in assignment list' };
            }

            assignment.availableDrivers[driverIndex].responded = true;
            assignment.availableDrivers[driverIndex].response = response;
            assignment.availableDrivers[driverIndex].responseTime =
                (Date.now() - assignment.availableDrivers[driverIndex].notifiedAt.getTime()) / 1000;

            if (rejectionReason) {
                assignment.availableDrivers[driverIndex].rejectionReason = rejectionReason;
            }

            if (response === 'accepted') {
                // Assign the order to this driver
                assignment.status = 'assigned';
                assignment.assignedDriverId = driverId;
                assignment.assignedAt = new Date();

                // Update order status and tracking
                await this.assignOrderToDriver(orderId, driverId);

                await assignment.save();

                return { success: true, message: 'Order assigned successfully' };
            } else {
                // Driver rejected, save the response
                await assignment.save();

                // If all drivers have responded and none accepted, handle failure
                const allResponded = assignment.availableDrivers.every(d => d.responded);
                if (allResponded) {
                    const hasAcceptance = assignment.availableDrivers.some(d => d.response === 'accepted');
                    if (!hasAcceptance) {
                        await this.handleAssignmentFailure(orderId, 'All drivers rejected the order');
                    }
                }

                return { success: true, message: 'Response recorded' };
            }

        } catch (error) {
            console.error('Error handling driver response:', error);
            return { success: false, error: error.message };
        }
    }

    // Assign order to driver
    async assignOrderToDriver(orderId, driverId) {
        try {
            const driver = await this.Driver.findById(driverId);
            if (!driver) {
                throw new Error('Driver not found');
            }

            const updateData = {
                status: 'assigned',
                'tracking.driverId': driverId,
                'tracking.driverInfo': {
                    name: driver.fullName,
                    phone: driver.phoneNumber,
                    vehicleType: driver.vehicleType,
                    vehicleNumber: driver.vehicleNumber || 'N/A',
                    rating: driver.rating || 5.0
                },
                'tracking.actualTimes.assignedAt': new Date()
            };

            await this.Order.findByIdAndUpdate(orderId, updateData);

            // Update driver status
            await this.Driver.findByIdAndUpdate(driverId, {
                availabilityStatus: 'on-ride'
            });

            // Add to assignment history
            await this.Order.findByIdAndUpdate(orderId, {
                $push: {
                    assignmentHistory: {
                        driverId,
                        status: 'assigned'
                    }
                }
            });

            return true;

        } catch (error) {
            console.error('Error assigning order to driver:', error);
            throw error;
        }
    }

    // Update order status with history tracking
    async updateOrderStatus(orderId, newStatus, updateInfo = {}) {
        try {
            const updateData = {
                status: newStatus,
                updatedAt: new Date()
            };

            // Add specific timestamp based on status
            switch (newStatus) {
                case 'picked_up':
                    updateData['tracking.actualTimes.pickedUpAt'] = new Date();
                    break;
                case 'in_transit':
                    updateData['tracking.actualTimes.inTransitAt'] = new Date();
                    break;
                case 'delivered':
                    updateData['tracking.actualTimes.deliveredAt'] = new Date();
                    break;
            }

            return await this.Order.findByIdAndUpdate(orderId, updateData, {new: true});

        } catch (error) {
            console.error('Error updating order status:', error);
            throw error;
        }
    }

    // Get order by ID with populated references
    async getOrderById(orderId) {
        try {
            const order = await this.Order.findById(orderId)
                .populate('clientId', 'fullName email phoneNumber')
                .populate('tracking.driverId', 'fullName phoneNumber vehicleType');

            return order;

        } catch (error) {
            console.error('Error getting order:', error);
            throw error;
        }
    }

    // Get orders for a client
    async getClientOrders(clientId, page = 1, limit = 20, status = null) {
        try {
            const query = { clientId };
            if (status) {
                query.status = status;
            }

            const orders = await this.Order.find(query)
                .populate('tracking.driverId', 'fullName phoneNumber vehicleType')
                .sort({ createdAt: -1 })
                .skip((page - 1) * limit)
                .limit(limit);

            const total = await this.Order.countDocuments(query);

            return {
                orders,
                pagination: {
                    page,
                    limit,
                    total,
                    pages: Math.ceil(total / limit)
                }
            };

        } catch (error) {
            console.error('Error getting client orders:', error);
            throw error;
        }
    }

    // Get orders for a driver
    async getDriverOrders(driverId, page = 1, limit = 20) {
        try {
            const query = { 'tracking.driverId': driverId };

            const orders = await this.Order.find(query)
                .populate('clientId', 'fullName phoneNumber')
                .sort({ createdAt: -1 })
                .skip((page - 1) * limit)
                .limit(limit);

            const total = await this.Order.countDocuments(query);

            return {
                orders,
                pagination: {
                    page,
                    limit,
                    total,
                    pages: Math.ceil(total / limit)
                }
            };

        } catch (error) {
            console.error('Error getting driver orders:', error);
            throw error;
        }
    }

    // Update order location (for real-time tracking)
    async updateOrderLocation(orderId, lat, lng, driverId) {
        try {
            const updateData = {
                'tracking.currentLocation': {
                    lat,
                    lng,
                    timestamp: new Date()
                },
                $push: {
                    'tracking.route': {
                        lat,
                        lng,
                        timestamp: new Date()
                    }
                }
            };

            await this.Order.findOneAndUpdate(
                { _id: orderId, 'tracking.driverId': driverId },
                updateData
            );

            return true;

        } catch (error) {
            console.error('Error updating order location:', error);
            throw error;
        }
    }

    // Handle assignment timeout
    async handleAssignmentTimeout(orderId) {
        try {
            const assignment = await this.OrderAssignment.findOne({ orderId, status: 'broadcasting' });
            if (!assignment) return;

            // Check if any driver accepted
            const acceptedDriver = assignment.availableDrivers.find(d => d.response === 'accepted');
            if (acceptedDriver) return;

            // Mark assignment as failed
            assignment.status = 'failed';
            assignment.failureReason = 'Assignment timeout - no driver response';
            await assignment.save();

            // Update order status
            await this.updateOrderStatus(orderId, 'failed', {
                notes: 'Assignment timeout - no available drivers responded',
                updatedBy: { userId: null, role: 'system' }
            });

        } catch (error) {
            console.error('Error handling assignment timeout:', error);
        }
    }

    // Handle assignment failure
    async handleAssignmentFailure(orderId, reason) {
        try {
            await this.OrderAssignment.findOneAndUpdate(
                { orderId },
                { status: 'failed', failureReason: reason }
            );

            await this.updateOrderStatus(orderId, 'failed', {
                notes: reason,
                updatedBy: { userId: null, role: 'system' }
            });

        } catch (error) {
            console.error('Error handling assignment failure:', error);
        }
    }

    // Cancel order
    async cancelOrder(orderId, cancelledBy, reason) {
        try {
            const order = await this.Order.findById(orderId);
            if (!order) {
                return { success: false, message: 'Order not found' };
            }

            // Check if order can be cancelled
            const cancellableStatuses = ['pending', 'broadcast', 'assigned'];
            if (!cancellableStatuses.includes(order.status)) {
                return {
                    success: false,
                    message: 'Order cannot be cancelled at this stage'
                };
            }

            // Calculate cancellation fee if applicable
            let cancellationFee = 0;
            if (order.status === 'assigned') {
                cancellationFee = order.pricing.totalAmount * 0.1; // 10% cancellation fee
            }

            const updateData = {
                status: 'cancelled',
                'cancellation.reason': reason,
                'cancellation.cancelledBy': cancelledBy,
                'cancellation.cancelledAt': new Date(),
                'cancellation.cancellationFee': cancellationFee
            };

            await this.Order.findByIdAndUpdate(orderId, updateData);

            // If driver was assigned, free them up
            if (order.tracking && order.tracking.driverId) {
                await this.Driver.findByIdAndUpdate(order.tracking.driverId, {
                    availabilityStatus: 'online'
                });
            }

            // Cancel any active assignments
            await this.OrderAssignment.findOneAndUpdate(
                { orderId },
                { status: 'cancelled' }
            );

            return {
                success: true,
                message: 'Order cancelled successfully',
                cancellationFee
            };

        } catch (error) {
            console.error('Error cancelling order:', error);
            return { success: false, error: error.message };
        }
    }

    // Rate order (by client or driver)
    async rateOrder(orderId, ratingData, ratedBy) {
        try {
            const { stars, feedback, raterType } = ratingData;

            const updateField = raterType === 'client' ? 'rating.clientRating' : 'rating.driverRating';

            const updateData = {
                [`${updateField}.stars`]: stars,
                [`${updateField}.feedback`]: feedback,
                [`${updateField}.ratedAt`]: new Date()
            };

            await this.Order.findByIdAndUpdate(orderId, updateData);

            return { success: true, message: 'Rating submitted successfully' };

        } catch (error) {
            console.error('Error rating order:', error);
            return { success: false, error: error.message };
        }
    }

    // Get available orders for driver (nearby pending orders)
    async getAvailableOrdersForDriver(driverId, lat, lng, radius = 10000) {
        try {
            const driver = await this.Driver.findById(driverId);
            if (!driver) {
                return { success: false, message: 'Driver not found' };
            }

            const orders = await this.Order.find({
                status: 'pending',
                vehicleRequirements: { $in: [driver.vehicleType] },
                'pickup.coordinates': {
                    $near: {
                        $geometry: { type: 'Point', coordinates: [lng, lat] },
                        $maxDistance: radius
                    }
                }
            })
                .populate('clientId', 'fullName phoneNumber')
                .limit(10)
                .sort({ createdAt: -1 });

            // Add distance calculation
            const ordersWithDistance = orders.map(order => ({
                ...order.toObject(),
                distance: this.calculateDistance(
                    lat, lng,
                    order.pickup.coordinates.lat,
                    order.pickup.coordinates.lng
                )
            }));

            return { success: true, orders: ordersWithDistance };

        } catch (error) {
            console.error('Error getting available orders:', error);
            return { success: false, error: error.message };
        }
    }

    // Notify drivers about new order (implement with your notification service)
    async notifyDrivers(drivers, order) {
        try {
            // This is where you'd integrate with your push notification service
            // For now, just logging
            console.log(`Notifying ${drivers.length} drivers about order ${order.orderRef}`);

            // Example notification payload
            const notificationPayload = {
                title: 'New Order Available',
                body: `Pickup: ${order.pickup.address}`,
                data: {
                    orderId: order._id.toString(),
                    orderRef: order.orderRef,
                    pickupAddress: order.pickup.address,
                    amount: order.pricing.totalAmount
                }
            };

            // Send to each driver
            for (const driver of drivers) {
                // await notificationService.sendToUser(driver._id, notificationPayload);
                console.log(`Notification sent to driver ${driver._id}`);
            }

        } catch (error) {
            console.error('Error sending notifications:', error);
        }
    }

    // Utility function to calculate distance between two points
    calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371; // Radius of the Earth in kilometers
        const dLat = this.deg2rad(lat2 - lat1);
        const dLon = this.deg2rad(lon2 - lon1);
        const a =
            Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(this.deg2rad(lat1)) * Math.cos(this.deg2rad(lat2)) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        const d = R * c; // Distance in kilometers
        return Math.round(d * 100) / 100; // Round to 2 decimal places
    }

    deg2rad(deg) {
        return deg * (Math.PI/180);
    }

    // Get order analytics/statistics
    async getOrderAnalytics(timeframe = '7d') {
        try {
            const startDate = new Date();

            switch (timeframe) {
                case '24h':
                    startDate.setHours(startDate.getHours() - 24);
                    break;
                case '7d':
                    startDate.setDate(startDate.getDate() - 7);
                    break;
                case '30d':
                    startDate.setDate(startDate.getDate() - 30);
                    break;
                default:
                    startDate.setDate(startDate.getDate() - 7);
            }

            const analytics = await this.Order.aggregate([
                {
                    $match: {
                        createdAt: { $gte: startDate }
                    }
                },
                {
                    $group: {
                        _id: '$status',
                        count: { $sum: 1 },
                        totalAmount: { $sum: '$pricing.totalAmount' },
                        avgAmount: { $avg: '$pricing.totalAmount' }
                    }
                }
            ]);

            const totalOrders = await this.Order.countDocuments({
                createdAt: { $gte: startDate }
            });

            const completedOrders = await this.Order.countDocuments({
                status: 'delivered',
                createdAt: { $gte: startDate }
            });

            const successRate = totalOrders > 0 ? (completedOrders / totalOrders) * 100 : 0;

            return {
                success: true,
                analytics: {
                    totalOrders,
                    completedOrders,
                    successRate: Math.round(successRate * 100) / 100,
                    statusBreakdown: analytics,
                    timeframe
                }
            };

        } catch (error) {
            console.error('Error getting order analytics:', error);
            return { success: false, error: error.message };
        }
    }
}

export default OrderService;
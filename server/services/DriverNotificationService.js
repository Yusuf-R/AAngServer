// /services/DriverNotificationService.js
import getModels from "../models/AAng/AAngLogistics"
import ExpoPushService from "./ExpoPushService"
import Order from "../models/Order";
import NotificationService from "./NotificationService";

class DriverNotificationService {
    /**
     * Main method - uses your existing NotificationService
     */
    async handleOrderAssignment(orderAssignment) {
        try {
            console.log(`🚀 Processing order assignment: ${orderAssignment._id}`);

            const order = await Order.findById(orderAssignment.orderId);
            if (!order) throw new Error(`Order ${orderAssignment.orderId} not found`);

            const results = {
                notificationsCreated: 0,
                pushNotifications: { success: 0, failed: 0 },
                errors: []
            };

            // Create notifications for all eligible drivers
            for (const driverData of orderAssignment.availableDrivers) {
                try {
                    // This will create in-app notifications via your existing system
                    const notification = await this.createDriverNotification(
                        driverData.driverId,
                        order,
                        orderAssignment._id
                    );

                    results.notificationsCreated++;

                    // Send push notification
                    const pushResult = await ExpoPushService.sendPushToDriver(
                        driverData.driverId,
                        order,
                        orderAssignment._id
                    );

                    if (pushResult.success) {
                        results.pushNotifications.success++;
                    } else {
                        results.pushNotifications.failed++;
                        results.errors.push({
                            driverId: driverData.driverId,
                            error: pushResult.error
                        });
                    }

                } catch (driverError) {
                    console.error(`Failed for driver ${driverData.driverId}:`, driverError);
                    results.pushNotifications.failed++;
                    results.errors.push({
                        driverId: driverData.driverId,
                        error: driverError.message
                    });
                }
            }

            console.log(`🎉 Notification summary:`, results);
            return results;

        } catch (error) {
            console.error('❌ Order assignment notification failed:', error);
            throw error;
        }
    }

    /**
     * Create driver notification using your existing NotificationService
     */
    async createDriverNotification(driverId, order, assignmentId) {
        const driver = await Driver.findById(driverId).select('fullName phoneNumber');

        return await NotificationService.createNotification({
            userId: driverId,
            type: 'delivery.driver_assigned',
            metadata: {
                orderId: order._id,
                orderRef: order.orderRef,
                driverId: driverId,
                assignmentId: assignmentId,
                totalAmount: order.pricing.totalAmount,
                source: 'system',
                channels: {
                    push: true,
                    inApp: true, // This triggers your SocketEmitter
                    sms: false,
                    email: false
                }
            },
            templateData: {
                driverName: driver.fullName,
                driverPhone: driver.phoneNumber,
                estimatedTime: this.calculateETA(order),
                orderId: order.orderRef,
                totalAmount: order.pricing.totalAmount,
                pickupLandmark: order.location.pickUp.landmark,
                dropoffLandmark: order.location.dropOff.landmark,
                packageCategory: order.package.category
            },
            priority: order.priority === 'urgent' ? 'HIGH' : 'NORMAL'
        });
    }

    calculateETA(order) {
        // Implement your ETA calculation logic
        const baseETA = 15; // minutes
        if (order.priority === 'urgent') return '10-15 mins';
        if (order.priority === 'high') return '15-20 mins';
        return '20-30 mins';
    }
}

export default new DriverNotificationService();
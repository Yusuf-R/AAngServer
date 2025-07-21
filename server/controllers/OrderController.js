import AuthController from "./AuthController";
import getOrderModels, {generateOrderRef} from "../models/Order";
import getModels from "../models/AAng/AAngLogistics";

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
                pickup: {
                    address: 'TBD',
                    coordinates: {
                        type: 'Point',
                        coordinates: [0, 0]
                    },
                    locationType: 'residential'
                },
                dropoff: {
                    address: 'TBD',
                    coordinates: {
                        type: 'Point',
                        coordinates: [0, 0]
                    },
                    locationType: 'residential'
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

            // get dashboard data
            const dashboardData = await AuthController.userDashBoardData(userData);
            if (!dashboardData) {
                return res.status(404).json({error: "Dashboard data not found"});
            }
            // Inject the just-created order directly
            dashboardData.orderData = draftOrder.toObject();

            return res.status(201).json({
                message: "Draft order created successfully",
                user: dashboardData
            });

        } catch (err) {
            console.error("Draft order creation error:", err);
            return res.status(500).json({
                error: "Failed to create draft order"
            });
        }
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
import AuthController from "./AuthController";
import amazonS3Client from "../aws/s3Client";
import getOrderModels, {generateOrderRef} from "../models/Order";
import getModels from "../models/AAng/AAngLogistics";

class S3Controller {
    static async GeneratePresignedUrl(req, res) {
        const preCheck = await AuthController.apiPreCheck(req);
        if (!preCheck.success) {
            return res.status(preCheck.statusCode).json(preCheck);
        }

        const {userData} = preCheck;
        const {orderId, fileType, fileName, fileCategory} = req.body;

        if (!orderId || !fileType || !fileName || !fileCategory) {
            return res.status(400).json({error: "Missing required fields."});
        }

        try {
            const {uploadURL, fileURL, key} = await amazonS3Client.generatePresignedUrl(
                fileType,
                fileCategory,
                userData._id,
                orderId,
                fileName
            );

            return res.status(200).json({uploadURL, fileURL, key});
        } catch (error) {
            console.error('S3 URL Generation Error:', error);
            return res.status(500).json({error: 'Failed to generate upload URL.'});
        }
    }

    static async GenerateDriverPresignedUrl(req, res) {
        const preCheck = await AuthController.apiPreCheck(req);
        if (!preCheck.success) {
            return res.status(preCheck.statusCode).json(preCheck);
        }

        const { userData } = preCheck;
        const { fileType, fileName, category, subcategory, fileIdentifier } = req.body;

        // Validate required fields
        if (!fileType || !fileName || !category) {
            return res.status(400).json({ error: "Missing required fields: fileType, fileName, category" });
        }

        // Validate category-specific fields
        if (category === 'identification' && (!subcategory || !fileIdentifier)) {
            return res.status(400).json({ error: "Identification requires subcategory (ID type) and fileIdentifier (front/back)" });
        }

        if ((category === 'vehiclePicture' || category === 'vehicleDocument') && (!subcategory || !fileIdentifier)) {
            return res.status(400).json({ error: "Vehicle files require subcategory (vehicle type) and fileIdentifier" });
        }

        try {
            const { uploadURL, fileURL, key } = await amazonS3Client.generateDriverPresignedUrl(
                fileType,
                category,
                subcategory,
                fileIdentifier,
                userData._id,
                fileName
            );

            return res.status(200).json({ uploadURL, fileURL, key });
        } catch (error) {
            console.error('Driver S3 URL Generation Error:', error);
            return res.status(500).json({ error: error.message || 'Failed to generate upload URL.' });
        }
    }

    static async listFiles(req, res) {
        const preCheck = await AuthController.apiPreCheck(req);
        if (!preCheck.success) {
            return res.status(preCheck.statusCode).json(preCheck);
        }

        const {userData} = preCheck;
        const {userId, orderId, type} = req.params;

        if (!orderId || !type || !['images', 'videos'].includes(type)) {
            return res.status(400).json({error: "Invalid parameters"});
        }

        const prefix = `Orders/${userId}/${orderId}/${type}/`;

        try {
            const files = await amazonS3Client.listFiles(prefix);
            const mapped = files.map(file => ({
                key: file.Key,
                url: amazonS3Client.getPublicUrl(file.Key)
            }));

            return res.status(200).json({files: mapped});
        } catch (error) {
            console.error("S3 listFiles error:", error);
            return res.status(500).json({error: "Could not list files."});
        }
    }

    static async DeleteFile(req, res) {
        const preCheck = await AuthController.apiPreCheck(req);
        if (!preCheck.success) {
            return res.status(preCheck.statusCode).json(preCheck);
        }

        const {key} = req.body;

        if (!key || typeof key !== 'string') {
            return res.status(400).json({error: "Missing or invalid 'key'."});
        }

        try {
            await amazonS3Client.deleteFile(key);
            return res.status(200).json({message: "File deleted successfully."});
        } catch (error) {
            console.error("S3 delete error:", error);
            return res.status(500).json({error: "Failed to delete file."});
        }
    }

    /**
     * Generate presigned URL for driver pickup/delivery confirmation
     * POST /api/driver/media/confirmation-presigned-url
     *
     * Body: {
     *   orderId: string,
     *   clientId: string,
     *   fileType: string,
     *   fileName: string,
     *   fileCategory: 'images' | 'videos',
     *   stage: 'pickup' | 'delivery' (optional)
     * }
     */
    static async GenerateDriverConfirmationPresignedUrl(req, res) {
        const preCheck = await AuthController.apiPreCheck(req);
        if (!preCheck.success) {
            return res.status(preCheck.statusCode).json(preCheck);
        }

        const { userData } = preCheck; // This is the driver
        const { orderId, clientId, fileType, fileName, fileCategory, stage } = req.body;

        // Validate required fields
        if (!orderId || !clientId || !fileType || !fileName || !fileCategory) {
            return res.status(400).json({
                error: "Missing required fields: orderId, clientId, fileType, fileName, fileCategory"
            });
        }

        // Validate file category
        if (!['images', 'videos'].includes(fileCategory)) {
            return res.status(400).json({
                error: "Invalid fileCategory. Must be 'images' or 'videos'"
            });
        }

        try {
            const {Order} = await getOrderModels();
            // Optional: Verify driver is assigned to this order
            const order = await Order.findById(orderId);
            if (!order || order.driverAssignment.driverId.toString() !== userData._id.toString()) {
                return res.status(403).json({ error: "You are not assigned to this order" });
            }

            const { uploadURL, fileURL, key } = await amazonS3Client.generateDriverConfirmationPresignedUrl(
                fileType,
                fileCategory,
                clientId,
                orderId,
                userData._id,
                fileName,
                stage || 'pickup'
            );

            return res.status(200).json({
                success: true,
                uploadURL,
                fileURL,
                key
            });
        } catch (error) {
            console.error('Driver Confirmation Presigned URL Error:', error);
            return res.status(500).json({
                error: error.message || 'Failed to generate upload URL.'
            });
        }
    }

    /**
     * List all media for an order (client + driver confirmation)
     * GET /api/driver/media/order/:orderId
     */
    static async ListOrderMedia(req, res) {
        const preCheck = await AuthController.apiPreCheck(req);
        if (!preCheck.success) {
            return res.status(preCheck.statusCode).json(preCheck);
        }

        const { orderId } = req.params;
        const { clientId } = req.query;

        if (!orderId || !clientId) {
            return res.status(400).json({ error: "Missing orderId or clientId" });
        }

        try {
            const media = await amazonS3Client.listOrderConfirmationMedia(clientId, orderId);

            return res.status(200).json({
                success: true,
                media
            });
        } catch (error) {
            console.error('List Order Media Error:', error);
            return res.status(500).json({
                error: 'Failed to list order media.'
            });
        }
    }

    /**
     * Generate presigned URL for PICKUP confirmation
     * POST /api/driver/media/pickup-confirmation-presigned-url
     */
    static async GenerateDriverPickUpConfirmationPresignedUrl(req, res) {
        const preCheck = await AuthController.apiPreCheck(req);
        if (!preCheck.success) {
            return res.status(preCheck.statusCode).json(preCheck);
        }

        const { userData } = preCheck;
        const { orderId, clientId, fileType, fileName, fileCategory } = req.body;

        // Validate required fields
        if (!orderId || !clientId || !fileType || !fileName || !fileCategory) {
            return res.status(400).json({
                error: "Missing required fields: orderId, clientId, fileType, fileName, fileCategory"
            });
        }

        // Validate file category
        if (!['images', 'videos'].includes(fileCategory)) {
            return res.status(400).json({
                error: "Invalid fileCategory. Must be 'images' or 'videos'"
            });
        }

        try {
            const { Order } = await getOrderModels();

            // Verify driver is assigned to this order
            const order = await Order.findById(orderId);
            if (!order) {
                return res.status(404).json({ error: "Order not found" });
            }

            if (!order.driverAssignment?.driverId ||
                order.driverAssignment.driverId.toString() !== userData._id.toString()) {
                return res.status(403).json({ error: "You are not assigned to this order" });
            }

            // Verify order is at pickup stage
            if (order.status !== 'arrived_pickup') {
                return res.status(400).json({
                    error: `Cannot upload pickup media. Order status is '${order.status}', expected 'arrived_pickup'`
                });
            }

            const { uploadURL, fileURL, key } = await amazonS3Client.generateDriverPickUpConfirmationPresignedUrl(
                fileType,
                fileCategory,
                clientId,
                orderId,
                userData._id,
                fileName,
            );

            return res.status(200).json({
                success: true,
                uploadURL,
                fileURL,
                key,
                stage: 'pickup'
            });
        } catch (error) {
            console.log('Driver Pickup Confirmation Presigned URL Error:', error);
            return res.status(500).json({
                error: error.message || 'Failed to generate upload URL.'
            });
        }
    }

    /**
     * Generate presigned URL for DROPOFF confirmation
     * POST /api/driver/media/dropoff-confirmation-presigned-url
     */
    static async GenerateDriverDropOffConfirmationPresignedUrl(req, res) {
        const preCheck = await AuthController.apiPreCheck(req);
        if (!preCheck.success) {
            return res.status(preCheck.statusCode).json(preCheck);
        }

        const { userData } = preCheck;
        const { orderId, clientId, fileType, fileName, fileCategory } = req.body;

        // Validate required fields
        if (!orderId || !clientId || !fileType || !fileName || !fileCategory) {
            return res.status(400).json({
                error: "Missing required fields: orderId, clientId, fileType, fileName, fileCategory"
            });
        }

        // Validate file category
        if (!['images', 'videos'].includes(fileCategory)) {
            return res.status(400).json({
                error: "Invalid fileCategory. Must be 'images' or 'videos'"
            });
        }

        try {
            const { Order } = await getOrderModels();

            // Verify driver is assigned to this order
            const order = await Order.findById(orderId);
            if (!order) {
                return res.status(404).json({ error: "Order not found" });
            }

            if (!order.driverAssignment?.driverId ||
                order.driverAssignment.driverId.toString() !== userData._id.toString()) {
                return res.status(403).json({ error: "You are not assigned to this order" });
            }

            // Verify order is at dropoff stage
            if (order.status !== 'arrived_dropoff') {
                return res.status(400).json({
                    error: `Cannot upload delivery media. Order status is '${order.status}', expected 'arrived_dropoff'`
                });
            }

            const { uploadURL, fileURL, key } = await amazonS3Client.generateDriverDropOffConfirmationPresignedUrl(
                fileType,
                fileCategory,
                clientId,
                orderId,
                userData._id,
                fileName
            );

            return res.status(200).json({
                success: true,
                uploadURL,
                fileURL,
                key,
                stage: 'delivery'
            });
        } catch (error) {
            console.log('Driver Dropoff Confirmation Presigned URL Error:', error);
            return res.status(500).json({
                error: error.message || 'Failed to generate upload URL.'
            });
        }
    }
}

module.exports = S3Controller;

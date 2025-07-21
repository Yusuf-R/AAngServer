import AuthController from "./AuthController";
import amazonS3Client from "../aws/s3Client";

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

}

module.exports = S3Controller;

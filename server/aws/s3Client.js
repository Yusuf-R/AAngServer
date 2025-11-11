// infrastructure/AmazonS3Client.js
const {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand,
    ListObjectsV2Command,
    CopyObjectCommand,
    HeadObjectCommand
} = require("@aws-sdk/client-s3");
const { Upload } = require("@aws-sdk/lib-storage");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { v4: uuidv4 } = require('uuid');
require('dotenv').config({ path: '../server/.env' });

class AmazonS3Client {
    constructor() {
        if (!AmazonS3Client.instance) {
            // Initialize AWS S3 client with v3 configuration
            this.client = new S3Client({
                region: process.env.S3_REGION ?? '',
                credentials: {
                    accessKeyId: process.env.S3_ACCESS_KEY ?? '',
                    secretAccessKey: process.env.S3_SECRET_KEY ?? '',
                }
            });

            this.bucketName = process.env.S3_BUCKET_NAME ?? '';

            AmazonS3Client.instance = this; // Singleton
        }

        return AmazonS3Client.instance;
    }

    async isAlive() {
        try {
            // Use ListObjectsV2Command with MaxKeys=1 to test connection
            const command = new ListObjectsV2Command({
                Bucket: this.bucketName,
                MaxKeys: 1
            });
            await this.client.send(command);
            return true;
        } catch (error) {
            console.error('❌ S3 Connection check failed:', error.message);
            return false;
        }
    }

    async uploadFile(fileBuffer, key, options = {}) {
        const uploadParams = {
            Bucket: this.bucketName,
            Key: key,
            Body: fileBuffer,
            ...options
        };

        try {
            // Use Upload from @aws-sdk/lib-storage for multipart uploads
            const upload = new Upload({
                client: this.client,
                params: uploadParams,
            });

            const data = await upload.done();
            return {
                location: data.Location,
                key: data.Key,
                etag: data.ETag
            };
        } catch (error) {
            console.log('❌ S3 Upload error:', error.message);
            throw error;
        }
    }

    async getFile(key) {
        try {
            const command = new GetObjectCommand({
                Bucket: this.bucketName,
                Key: key
            });
            return await this.client.send(command);
        } catch (error) {
            console.error('❌ S3 GetFile error:', error.message);
            throw error;
        }
    }

    async deleteFile(key) {
        try {
            const command = new DeleteObjectCommand({
                Bucket: this.bucketName,
                Key: key
            });
            await this.client.send(command);
            return true;
        } catch (error) {
            console.error('❌ S3 Delete error:', error.message);
            throw error;
        }
    }

    async generatePresignedUrl(fileType, fileCategory, userId, orderId, fileName) {
        if (!['images', 'videos'].includes(fileCategory)) {
            throw new Error('Invalid file category');
        }

        const key = `Orders/${userId}/${orderId}/${fileCategory}/${Date.now()}-${uuidv4()}-${fileName}`;

        const command = new PutObjectCommand({
            Bucket: this.bucketName,
            Key: key,
            ContentType: fileType,
        });

        try {
            const uploadURL = await getSignedUrl(this.client, command, {
                expiresIn: 300, // 5 minutes
            });
            const fileURL = `https://${this.bucketName}.s3.${process.env.S3_REGION}.amazonaws.com/${key}`;
            return { uploadURL, fileURL, key };
        } catch (error) {
            console.error('❌ Presigned URL error:', error.message);
            throw error;
        }
    }

    async generateDriverPresignedUrl(fileType, category, subcategory, fileIdentifier, driverId, fileName) {
        const timestamp = Date.now();
        const ext = fileName.split('.').pop();

        // Generate structured path based on category
        let key;

        switch(category) {
            case 'profile':
                key = `Drivers/${driverId}/profile/${timestamp}.${ext}`;
                break;

            case 'identification':
                // subcategory = identificationType (e.g., 'drivers_license')
                // fileIdentifier = 'front' or 'back'
                key = `Drivers/${driverId}/identification/${subcategory}/${fileIdentifier}.${ext}`;
                break;

            case 'vehiclePicture':
                // subcategory = vehicleType (e.g., 'motorcycle')
                // fileIdentifier = 'front', 'rear', 'side'
                key = `Drivers/${driverId}/vehicle/${subcategory}/pictures/${fileIdentifier}.${ext}`;
                break;

            case 'vehicleDocument':
                // subcategory = vehicleType
                // fileIdentifier = 'license', 'insurance', 'roadWorthiness', etc.
                key = `Drivers/${driverId}/vehicle/${subcategory}/documents/${fileIdentifier}.${ext}`;
                break;

            default:
                throw new Error('Invalid file category');
        }

        const command = new PutObjectCommand({
            Bucket: this.bucketName,
            Key: key,
            ContentType: fileType,
        });

        try {
            const uploadURL = await getSignedUrl(this.client, command, {
                expiresIn: 300, // 5 minutes
            });
            const fileURL = `https://${this.bucketName}.s3.${process.env.S3_REGION}.amazonaws.com/${key}`;
            return { uploadURL, fileURL, key };
        } catch (error) {
            console.error('❌ Driver Presigned URL error:', error.message);
            throw error;
        }
    }

    async listFiles(prefix = '') {
        try {
            const command = new ListObjectsV2Command({
                Bucket: this.bucketName,
                Prefix: prefix
            });
            const data = await this.client.send(command);
            return data.Contents || [];
        } catch (error) {
            console.error('❌ List files error:', error.message);
            throw error;
        }
    }

    async copyFile(sourceKey, destinationKey) {
        try {
            const command = new CopyObjectCommand({
                Bucket: this.bucketName,
                CopySource: `/${this.bucketName}/${sourceKey}`,
                Key: destinationKey
            });
            await this.client.send(command);
            return true;
        } catch (error) {
            console.error('❌ Copy error:', error.message);
            throw error;
        }
    }

    async uploadImage(buffer, filename, contentType) {
        const key = `images/${Date.now()}-${filename}`;
        return this.uploadFile(buffer, key, {
            ContentType: contentType,
            ACL: 'public-read'
        });
    }

    async uploadVideo(buffer, filename, contentType) {
        const key = `videos/${Date.now()}-${filename}`;
        return this.uploadFile(buffer, key, {
            ContentType: contentType,
            ACL: 'public-read'
        });
    }

    getPublicUrl(key) {
        return `https://${this.bucketName}.s3.${process.env.S3_REGION}.amazonaws.com/${key}`;
    }

    async checkFileExists(key) {
        try {
            const command = new HeadObjectCommand({
                Bucket: this.bucketName,
                Key: key
            });
            await this.client.send(command);
            return true;
        } catch (error) {
            if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
                return false;
            }
            throw error;
        }
    }

    /**
     * Generate presigned URL for driver pickup/delivery confirmation media
     * Supports the nested folder structure: /clientId/orderId/confirmed-order/driverId/images|videos/
     *
     * @param {string} fileType - MIME type (e.g., 'image/jpeg', 'video/mp4')
     * @param {string} fileCategory - 'images' or 'videos'
     * @param {string} clientId - Client who created the order
     * @param {string} orderId - Order being confirmed
     * @param {string} driverId - Driver confirming pickup/delivery
     * @param {string} fileName - Original filename
     * @param {string} stage - 'pickup' or 'delivery' (optional, for future use)
     * @returns {Promise<{uploadURL: string, fileURL: string, key: string}>}
     */
    async generateDriverConfirmationPresignedUrl(fileType, fileCategory, clientId, orderId, driverId, fileName, stage = 'pickup') {
        // Validate file category
        if (!['images', 'videos'].includes(fileCategory)) {
            throw new Error('Invalid file category. Must be "images" or "videos"');
        }

        // Validate file type
        const validImageTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
        const validVideoTypes = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/mpeg'];

        if (fileCategory === 'images' && !validImageTypes.includes(fileType.toLowerCase())) {
            throw new Error('Invalid image file type');
        }

        if (fileCategory === 'videos' && !validVideoTypes.includes(fileType.toLowerCase())) {
            throw new Error('Invalid video file type');
        }

        // Generate unique filename to prevent overwrites
        const timestamp = Date.now();
        const uniqueId = uuidv4().substring(0, 8);
        const ext = fileName.split('.').pop();
        const sanitizedFilename = `${timestamp}-${uniqueId}.${ext}`;

        // Build S3 key following your structure
        // Orders/{clientId}/{orderId}/confirmed-order/{driverId}/images or videos/{filename}
        const key = `Orders/${clientId}/${orderId}/confirmed-order/${driverId}/${fileCategory}/${sanitizedFilename}`;

        const command = new PutObjectCommand({
            Bucket: this.bucketName,
            Key: key,
            ContentType: fileType,
        });

        try {
            const uploadURL = await getSignedUrl(this.client, command, {
                expiresIn: 300, // 5 minutes
            });

            const fileURL = `https://${this.bucketName}.s3.${process.env.S3_REGION}.amazonaws.com/${key}`;

            return { uploadURL, fileURL, key };
        } catch (error) {
            console.error('❌ Driver Confirmation Presigned URL error:', error.message);
            throw error;
        }
    }

    /**
     * List all confirmation media for a specific order
     * Useful for retrieving both client and driver media in one call
     *
     * @param {string} clientId
     * @param {string} orderId
     * @returns {Promise<{clientMedia: {images: [], videos: []}, driverMedia: {images: [], videos: []}}>}
     */
    async listOrderConfirmationMedia(clientId, orderId) {
        try {
            const orderPrefix = `Orders/${clientId}/${orderId}/`;

            const command = new ListObjectsV2Command({
                Bucket: this.bucketName,
                Prefix: orderPrefix
            });

            const data = await this.client.send(command);
            const files = data.Contents || [];

            // Organize files by type
            const result = {
                clientMedia: {
                    images: [],
                    videos: []
                },
                driverMedia: {
                    images: [],
                    videos: []
                }
            };

            files.forEach(file => {
                const key = file.Key;
                const url = this.getPublicUrl(key);
                const fileObj = {
                    key,
                    url,
                    size: file.Size,
                    lastModified: file.LastModified
                };

                // Categorize files
                if (key.includes('/confirmed-order/')) {
                    // Driver confirmation media
                    if (key.includes('/images/')) {
                        result.driverMedia.images.push(fileObj);
                    } else if (key.includes('/videos/')) {
                        result.driverMedia.videos.push(fileObj);
                    }
                } else {
                    // Client original media
                    if (key.includes('/images/')) {
                        result.clientMedia.images.push(fileObj);
                    } else if (key.includes('/videos/')) {
                        result.clientMedia.videos.push(fileObj);
                    }
                }
            });

            return result;
        } catch (error) {
            console.error('❌ List order media error:', error.message);
            throw error;
        }
    }
}

const amazonS3Client = new AmazonS3Client();
module.exports = amazonS3Client;
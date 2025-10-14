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
}

const amazonS3Client = new AmazonS3Client();
module.exports = amazonS3Client;
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

// Environment variable for MongoDB URI

class MongoDBClient {
    constructor() {
        this.connection = {};
    }

    // Initialize MongoDB connection
    async connect() {
        // Check if already connected
        if (this.connection.isConnected) {
            console.log("💡 Already connected to MongoDB 😁 ");
            return;
        }

        // Check if MONGODB_URI is available
        if (!process.env.MONGODB_URI) {
            console.log("👺 Error: Invalid/Missing environment variable MONGODB_URI 🚨");
            return;
        }

        // Attempt to connect
        try {
            const db = await mongoose.connect(process.env.MONGODB_URI);
            // Track connection state
            this.connection.isConnected = db.connections[0].readyState;

            if (this.connection.isConnected === 1) {
                console.log("🚀 Successfully connected to MongoDB 🤩 ");
            } else {
                console.log("👺 Failed to connect to MongoDB 🚨 ");
            }
        } catch (error) {
            console.log("👺 Error connecting to MongoDB: 🚨", error.message);
        }
    }

    // Check if the connection is alive
    async isAlive() {
        return await this.connection.isConnected === 1;
    }

    // Close the MongoDB connection
    async close() {
        if (this.connection.isConnected) {
            await mongoose.disconnect();
            console.log("🔌 MongoDB connection closed");
            this.connection.isConnected = false;
        }
    }
}

// Create an instance of the class
const dbClient = new MongoDBClient();
export default dbClient;
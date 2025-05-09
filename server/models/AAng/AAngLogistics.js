// /models/AAng/AAngLogistics.js
import mongoose from "mongoose";
import dbClient from "../../database/mongoDB";

const { Schema, model } = mongoose;

// Connect if not already connected
const connectDB = async () => {
    if (mongoose.connection.readyState !== 1) {
        await dbClient.connect();
    }
};

// Core schema shared by all roles
const baseOptions = {
    discriminatorKey: "role",
    timestamps: true,
};

const AAngSchema = new Schema({
    email: {
        type: String,
        unique: true,
        required: true,
        match: [/^\S+@\S+\.\S+$/, "Invalid email format"],
    },
    password: {
        type: String,
        required: function () {
            return !this.googleId && !this.iosId;
        },
    },
    fullName: String,
    avatar: String,
    status: {
        type: String,
        enum: [
            "Active", "Inactive", "Suspended", "Banned",
            "Deleted", "Pending", "Blocked",
        ],
        default: "Active",
    },
    phoneNumber: String,
    dob: String,
    gender: { type: String, enum: ["Male", "Female"] },
    provider: {
        type: String,
        enum : ['Google', 'Apple', 'Credentials'],
        default: 'Credentials', // Assume default is form-based
    },
    googleId: String,
    iosId: String,
    sessionTokens: [{
        token: String,
        createdAt: { type: Date, default: Date.now },
    }],
}, baseOptions);

// Address Schema for users
const AddressSchema = new Schema({
    category: {
        type: String,
        enum: [
            "Home", "School", "Office", "MarketPlace", "Mosque",
            "Church", "Hospital", "Hotel", "SuperMarket", "Others"
        ],
        required: true,
    },
    latitude: Number,
    longitude: Number,
    locationName: String,
    description: String,
}, { _id: true });

// User-specific schema
const ClientSchema = new Schema({
    addresses: { type: [AddressSchema], default: [] },
    rideHistory: { type: Array, default: [] },
});

// Driver-specific schema
const DriverSchema = new Schema({
    licenseNumber: String,
    vehicleType: String,
    earnings: { type: Number, default: 0 },
    availabilityStatus: {
        type: String,
        enum: ["online", "offline", "on-ride"],
        default: "offline",
    },
});

// Admin schema (optional)
const AdminSchema = new Schema({
    permissions: {
        type: [String],
        default: ["manage-users", "manage-requests"],
    },
});

const getModels = async () => {
    await connectDB();

    const AAngBase = mongoose.models.Base || model("Base", AAngSchema);
    const Client = mongoose.models.Client || AAngBase.discriminator("Client", ClientSchema);
    const Driver = mongoose.models.Driver || AAngBase.discriminator("Driver", DriverSchema);
    const Admin = mongoose.models.Admin || AAngBase.discriminator("Admin", AdminSchema);

    return { AAngBase, Client, Driver, Admin };
};

export default getModels;

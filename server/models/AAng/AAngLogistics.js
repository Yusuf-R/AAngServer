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

// Authentication methods schema
const AuthMethodSchema = new Schema({
    type: {
        type: String,
        enum: ['Google', 'Apple', 'Credentials'],
        required: true
    },
    providerId: String,  // googleId, appleId, etc.
    verified: {
        type: Boolean,
        default: false
    },
    lastUsed: {
        type: Date,
        default: Date.now
    }
}, { _id: false });

const AAngSchema = new Schema({
    email: {
        type: String,
        unique: true,
        required: true,
        match: [/^\S+@\S+\.\S+$/, "Invalid email format"],
    },
    password: {
        type: String,
        required: function() {
            // Password is required only if Credentials auth method exists
            return this.authMethods &&
                this.authMethods.some(method => method.type === 'Credentials');
        }
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

    // New auth structure
    authMethods: {
        type: [AuthMethodSchema],
        validate: {
            validator: function(methods) {
                return methods && methods.length > 0;
            },
            message: 'At least one authentication method is required'
        }
    },

    // Preferred auth method
    preferredAuthMethod: {
        type: String,
        enum: ['Google', 'Apple', 'Credentials'],
        default: 'Credentials'
    },

    // For backward compatibility
    provider: {
        type: String,
        enum: ['Google', 'Apple', 'Credentials'],
        default: 'Credentials'
    },

    // Session handling
    sessionTokens: [{
        token: String,
        device: String,
        ip: String,
        createdAt: { type: Date, default: Date.now },
        lastActive: { type: Date, default: Date.now }
    }],

    // Password reset
    resetPasswordToken: String,
    resetPasswordExpiry: Date,

    // Email verification
    emailVerificationToken: String,
    emailVerificationExpiry: Date,
    emailVerified: {
        type: Boolean,
        default: false
    }
}, baseOptions);

// Virtual property to check if user has password
AAngSchema.virtual('hasPassword').get(function() {
    return !!this.password;
});

// Pre-save middleware to update legacy fields
AAngSchema.pre('save', function(next) {
    // Update provider field based on preferred auth method
    if (this.preferredAuthMethod) {
        this.provider = this.preferredAuthMethod;
    } else if (this.authMethods && this.authMethods.length > 0) {
        // Set preferred auth method to first method if not set
        this.preferredAuthMethod = this.authMethods[0].type;
        this.provider = this.authMethods[0].type;
    }
    next();
});

// Address Schema for users (unchanged)
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

// User-specific schema (unchanged)
const ClientSchema = new Schema({
    addresses: { type: [AddressSchema], default: [] },
    rideHistory: { type: Array, default: [] },
});

// Driver-specific schema (unchanged)
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

// Admin schema (unchanged)
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
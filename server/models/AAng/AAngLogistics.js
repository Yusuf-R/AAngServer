// /models/AAng/AAngLogistics.js
import mongoose from "mongoose";
import dbClient from "../../database/mongoDB";

const { Schema, model } = mongoose;

const connectDB = async () => {
    if (mongoose.connection.readyState !== 1) {
        await dbClient.connect();
    }
};

const baseOptions = {
    discriminatorKey: "role",
    timestamps: true,
};

const AuthMethodSchema = new Schema({
    type: {
        type: String,
        enum: ['Google', 'Apple', 'Credentials', 'AuthPin'],
        required: true
    },
    providerId: String,
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
            return this.authMethods && this.authMethods.some(method => method.type === 'Credentials');
        }
    },
    fullName: String,
    avatar: String,
    status: {
        type: String,
        enum: ["Active", "Inactive", "Suspended", "Banned", "Deleted", "Pending", "Blocked"],
        default: "Active",
    },
    phoneNumber: String,
    dob: String,
    gender: { type: String, enum: ["Male", "Female"] },

    authPin: {
        pin: { type: String },
        isEnabled: { type: Boolean, default: false },
        createdAt: { type: Date, default: Date.now },
        lastUsed: { type: Date },
        failedAttempts: { type: Number, default: 0 },
        lockedUntil: { type: Date }
    },
    // terms and conditions -- tcs
    tcs: {
        isAccepted: {
            type: Boolean, default: false
        },
        acceptedAt: {type: Date, default: Date.now},
        version: {type: String, default: '1.0'},
    },

    pinVerificationToken: {
        token: String,
        email: String,
        purpose: { type: String, enum: ['CHANGE_PIN', 'RESET_PIN'] },
        createdAt: { type: Date },
        expiresAt: {
            type: Date,
            default: () => new Date(Date.now() + 10 * 60 * 1000)
        },
        used: { type: Boolean, default: false }
    },

    authMethods: {
        type: [AuthMethodSchema],
        validate: {
            validator: function(methods) {
                return methods && methods.length > 0;
            },
            message: 'At least one authentication method is required'
        }
    },

    preferredAuthMethod: {
        type: String,
        enum: ['Google', 'Apple', 'Credentials', 'AuthPin'],
        default: 'Credentials'
    },

    provider: {
        type: String,
        enum: ['Google', 'Apple', 'Credentials', 'AuthPin'],
        default: 'Credentials'
    },

    sessionTokens: [{
        token: String,
        device: String,
        ip: String,
        createdAt: { type: Date, default: Date.now },
        lastActive: { type: Date, default: Date.now }
    }],

    resetPasswordToken: String,
    resetPasswordExpiry: Date,

    emailVerificationToken: String,
    emailVerificationExpiry: Date,
    emailVerified: { type: Boolean, default: false },

    authPinResetToken: String,
    authPinResetExpiry: Date

}, baseOptions);

AAngSchema.virtual('hasPassword').get(function() {
    return !!this.password;
});

AAngSchema.virtual('pinStatus').get(function() {
    return {
        isSet: !!(this.authPin && this.authPin.pin),
        setDate: this.authPin?.createdAt,
        lastChanged: this.authPin?.createdAt,
        canChange: this.emailVerified,
        isLocked: this.authPin?.lockedUntil && this.authPin.lockedUntil > new Date(),
        attemptsRemaining: Math.max(0, 5 - (this.authPin?.failedAttempts || 0))
    };
});

AAngSchema.pre('save', function(next) {
    if (this.preferredAuthMethod) {
        this.provider = this.preferredAuthMethod;
    } else if (this.authMethods && this.authMethods.length > 0) {
        this.preferredAuthMethod = this.authMethods[0].type;
        this.provider = this.authMethods[0].type;
    }
    next();
});

// 🛑 Removed TTL index on pinVerificationToken.expiresAt (was deleting full document)

const AddressSchema = new Schema({
    category: {
        type: String,
        enum: ["Home", "School", "Office", "MarketPlace", "Mosque", "Church", "Hospital", "Hotel", "SuperMarket", "Others"],
        required: true,
    },
    latitude: Number,
    longitude: Number,
    locationName: String,
    description: String,
}, { _id: true });

const ClientSchema = new Schema({
    addresses: { type: [AddressSchema], default: [] },
    rideHistory: { type: Array, default: [] },
});

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

// /models/RefreshToken.js
import mongoose from 'mongoose';

// 30 days in seconds (for token expiration)
const REFRESH_TOKEN_EXP = 60 * 60 * 24 * 30;

const refreshTokenSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Base',
            required: true,
            index: true
        },
        token: {
            type: String,
            required: true,
            unique: true,
        },
        userAgent: String,
        device: String,
        ip: String,
        authMethod: {
            type: String,
            enum: ['Google', 'Apple', 'Credentials'],
            default: 'Credentials'
        },
        lastUsed: {
            type: Date,
            default: Date.now
        },
        expiresAt: {
            type: Date,
            default: () => new Date(Date.now() + REFRESH_TOKEN_EXP * 1000),
            index: true
        }
    },
    {
        timestamps: true,
    }
);

// Automatically delete expired refresh tokens
refreshTokenSchema.index({ createdAt: 1 }, { expireAfterSeconds: REFRESH_TOKEN_EXP });

// Check if a token is expired
refreshTokenSchema.methods.isExpired = function() {
    return Date.now() > this.expiresAt.getTime();
};

// Method to update lastUsed timestamp
refreshTokenSchema.methods.updateLastUsed = function() {
    this.lastUsed = Date.now();
    return this.save();
};

// Avoid model overwrite error in development environments
const RefreshToken = mongoose.models.RefreshToken || mongoose.model('RefreshToken', refreshTokenSchema);

export default RefreshToken;
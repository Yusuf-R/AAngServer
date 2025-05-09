// /models/RefreshToken.js
const mongoose = require('mongoose');
const REFRESH_TOKEN_EXP = 60 * 60 * 24 * 30; // 30 days (in seconds)

const refreshTokenSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Base', // Referencing the base model (Client/Driver/Admin are discriminators)
            required: true,
        },
        token: {
            type: String,
            required: true,
            unique: true,
        },
        userAgent: {
            type: String,
            default: null,
        },
        ip: {
            type: String,
            default: null,
        },
    },
    {
        timestamps: true,
    }
);

// 🧹 Automatically delete expired refresh tokens
refreshTokenSchema.index({ createdAt: 1 }, { expireAfterSeconds: REFRESH_TOKEN_EXP });

// Avoid model overwrite error in development environments
const RefreshToken = mongoose.models.RefreshToken || mongoose.model('RefreshToken', refreshTokenSchema);

export default RefreshToken;

// /models/RefreshToken.js
import mongoose from 'mongoose';

// 30 days in seconds (for production)
const REFRESH_TOKEN_EXP = 60 * 60 * 24 * 30;
// const REFRESH_TOKEN_EXP = 60 * 2; // 2mins for testing

const refreshTokenSchema = new mongoose.Schema(
    {
        // Safe to use ref now that TTL is removed
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Base',
            required: true,
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
            enum: ['Google', 'Apple', 'Credentials', 'AuthPin'],
            default: 'Credentials'
        },
        lastUsed: {
            type: Date,
            default: Date.now
        },
        expiresAt: {
            type: Date,
            default: () => new Date(Date.now() + REFRESH_TOKEN_EXP * 1000),
        },
    },
    {
        timestamps: true,
    }
);

// TTL index ONLY on expiresAt - no cascading effects
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Additional indexes for better performance
refreshTokenSchema.index({ token: 1, userId: 1, authMethod: 1 });

// Check if a token is expired
refreshTokenSchema.methods.isExpired = function() {
    return Date.now() > this.expiresAt.getTime();
};

// Method to update lastUsed timestamp
refreshTokenSchema.methods.updateLastUsed = function() {
    this.lastUsed = Date.now();
    return this.save();
};

// Method to extend expiration (useful for "remember me" functionality)
refreshTokenSchema.methods.extendExpiration = function(additionalSeconds = REFRESH_TOKEN_EXP) {
    this.expiresAt = new Date(Date.now() + additionalSeconds * 1000);
    return this.save();
};

// Static method to clean up expired tokens manually (backup cleanup)
refreshTokenSchema.statics.cleanupExpired = async function() {
    try {
        const result = await this.deleteMany({
            expiresAt: { $lt: new Date() }
        });
        console.log(`Cleaned up ${result.deletedCount} expired refresh tokens`);
        return result;
    } catch (error) {
        console.error('Error cleaning up expired tokens:', error);
        throw error;
    }
};


// Static method to validate and auto-cleanup expired tokens
refreshTokenSchema.statics.findValidToken = async function(userId, token) {
    try {
        const refreshToken = await this.findOne({ userId, token }).populate('userId');

        if (!refreshToken) {
            console.log('❌ Refresh token not found in database');
            return null;
        }

        // Check if token is expired
        if (refreshToken.isExpired()) {
            console.log('⏰ Refresh token expired, cleaning up...');
            await refreshToken.deleteOne();
            return null;
        }

        // Check if user still exists and is active
        if (!refreshToken.userId) {
            console.log('❌ User associated with refresh token no longer exists');
            await refreshToken.deleteOne();
            return null;
        }

        // Check user status
        const user = refreshToken.userId;
        if (['inactive', 'suspended', 'banned', 'deleted'].includes(user.status?.toLowerCase())) {
            console.log(`❌ User account status is ${user.status}, revoking token`);
            await refreshToken.deleteOne();
            return null;
        }

        return refreshToken;
    } catch (error) {
        console.error('Error finding valid token:', error);
        return null;
    }
};

// Static method to revoke all user tokens
refreshTokenSchema.statics.revokeAllUserTokens = async function(userId) {
    try {
        const result = await this.deleteMany({ userId: userId.toString() });
        console.log(`Revoked ${result.deletedCount} tokens for user ${userId}`);
        return result;
    } catch (error) {
        console.error('Error revoking user tokens:', error);
        throw error;
    }
};


// Avoid model overwrite error in development environments
const RefreshToken = mongoose.models.RefreshToken || mongoose.model('RefreshToken', refreshTokenSchema);

export default RefreshToken;
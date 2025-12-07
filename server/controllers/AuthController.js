import dbClient from "../database/mongoDB";
import ms from 'ms';
import jwt from "jsonwebtoken";
import getModels from "../models/AAng/AAngLogistics";

import RefreshToken from "../models/RefreshToken";
import NotificationService from "../services/NotificationService";
import bcrypt from 'bcrypt';
import {OAuth2Client} from 'google-auth-library';
import redisClient from '../utils/redis';
import nodemailer from 'nodemailer';
import {UAParser} from 'ua-parser-js';
import MailClient from '../utils/mailer';
import {logInSchema, resetPasswordSchema, signUpSchema, validateSchema} from "../validators/validateAuth";
import {cloudinary} from '../utils/cloudinary'
import getOrderModels from "../models/Order";
import DriverController from "./DriverController"
import admin from "../utils/firebaseAdmin";

import order from "../models/Order";

// Environment variables
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const accessSecret = process.env.JWT_ACCESS_SECRET;
const refreshSecret = process.env.JWT_REFRESH_SECRET;
const accessExpires = process.env.JWT_ACCESS_EXPIRES_IN;
const refreshExpires = process.env.JWT_REFRESH_EXPIRES_IN;
const accessExpiresMs = ms(accessExpires);
const api_key = process.env.CLOUDINARY_API_KEY;


// Email configuration for password reset and verification
const transporter = nodemailer.createTransport({
    service: 'Gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

class AuthController {
    /**
     * Check database and Redis connections
     */
    static async checkConn(req, res) {
        try {
            const dbStatus = await dbClient.isAlive();
            const redisStatus = await redisClient.isAlive();

            if (!dbStatus) {
                return res.status(500).json({error: 'Database connection failed'});
            }
            if (!redisStatus) {
                return res.status(500).json({error: 'Redis connection failed'});
            }

            return res.status(200).json({
                message: 'Server is up and running',
                redisStatus,
                dbStatus,
            });
        } catch (error) {
            console.error('Connection check error:', error);
            return res.status(500).json({error: 'Failed to check connections'});
        }
    }

    // Backend Controller
    static async updatePushToken(req, res) {
        try {
            // Perform API pre-check
            const preCheckResult = await AuthController.apiPreCheck(req);

            if (!preCheckResult.success) {
                return res.status(preCheckResult.statusCode).json({
                    error: preCheckResult.error,
                    ...(preCheckResult.tokenExpired && {tokenExpired: true})
                });
            }

            const {expoPushToken, enabled} = req.body;
            const {userData} = preCheckResult;
            const {AAngBase} = await getModels();

            // Fetch current user data
            const existingUser = await AAngBase.findById(userData._id);

            if (!existingUser) {
                return res.status(404).json({error: 'User not found'});
            }

            // CASE 1: Toggle operation (no token provided, just enabled flag)
            if (expoPushToken === undefined && enabled !== undefined) {
                // User is just toggling notifications on/off
                if (!existingUser.expoPushToken) {
                    return res.status(400).json({
                        error: 'No push token registered. Please enable notifications first.',
                        requiresTokenRegistration: true
                    });
                }

                await AAngBase.updateOne(
                    {_id: userData._id},
                    {
                        $set: {
                            'pushTokenStatus.isSubscribed': enabled,
                            'pushTokenStatus.lastVerified': new Date(),
                        }
                    }
                );

                console.log(`🔔 Push notifications ${enabled ? 'enabled' : 'disabled'} for user ${userData._id}`);

                return res.status(200).json({
                    success: true,
                    message: `Notifications ${enabled ? 'enabled' : 'disabled'} successfully`,
                    isSubscribed: enabled,
                    toggleOnly: true
                });
            }

            // CASE 2: Token registration/update (token provided)
            if (expoPushToken) {
                // Validate Expo push token format
                if (!expoPushToken.startsWith('ExponentPushToken[') || !expoPushToken.endsWith(']')) {
                    return res.status(400).json({error: 'Invalid push token format'});
                }

                // Check if token is unchanged
                if (existingUser.expoPushToken === expoPushToken) {
                    // Token unchanged, just update metadata and subscription status
                    const updateData = {
                        'pushTokenStatus.lastVerified': new Date(),
                        'pushTokenStatus.valid': true,
                    };

                    // If enabled flag is provided, update subscription status
                    if (enabled !== undefined) {
                        updateData['pushTokenStatus.isSubscribed'] = enabled;
                    }

                    await AAngBase.updateOne(
                        {_id: userData._id},
                        {$set: updateData}
                    );

                    return res.status(200).json({
                        success: true,
                        message: 'Push token verified (unchanged)',
                        tokenUnchanged: true,
                        isSubscribed: enabled !== undefined ? enabled : existingUser.pushTokenStatus?.isSubscribed
                    });
                }

                // Token is new or changed, update everything
                const updateData = {
                    expoPushToken,
                    'pushTokenStatus.valid': true,
                    'pushTokenStatus.lastVerified': new Date(),
                    'pushTokenStatus.failureCount': 0,
                };

                // Default to enabled on new token registration, or use provided value
                updateData['pushTokenStatus.isSubscribed'] = enabled !== undefined ? enabled : true;

                await AAngBase.updateOne(
                    {_id: userData._id},
                    {$set: updateData}
                );

                console.log(`✅ Push token ${existingUser.expoPushToken ? 'updated' : 'registered'} for user ${userData._id}`);

                return res.status(200).json({
                    success: true,
                    message: 'Push token registered successfully',
                    tokenUpdated: true,
                    isSubscribed: updateData['pushTokenStatus.isSubscribed']
                });
            }

            // CASE 3: Invalid request (neither token nor enabled provided)
            return res.status(400).json({
                error: 'Invalid request. Provide either expoPushToken or enabled flag.'
            });

        } catch (error) {
            console.error('Error updating push token:', error);
            return res.status(500).json({error: 'Failed to update push token'});
        }
    }

    /**
     * Mark a push token as invalid (call this when Expo returns an error)
     */
    static async markTokenAsInvalid(userId) {
        try {
            const {AAngBase} = await getModels();

            await AAngBase.updateOne(
                {_id: userId},
                {
                    $set: {
                        'pushTokenStatus.valid': false,
                        'pushTokenStatus.lastVerified': new Date()
                    },
                    $inc: {
                        'pushTokenStatus.failureCount': 1
                    }
                }
            );

            console.log(`❌ Marked push token as invalid for user ${userId}`);
        } catch (error) {
            console.error('Error marking token as invalid:', error);
        }
    }

    /**
     * Get users with valid push tokens for sending notifications
     */
    static async getUsersWithValidTokens(userIds) {
        try {
            const {AAngBase} = await getModels();

            return await AAngBase.find({
                _id: {$in: userIds},
                expoPushToken: {$exists: true, $ne: null},
                'pushTokenStatus.valid': true
            }).select('_id expoPushToken');

        } catch (error) {
            console.error('Error getting users with valid tokens:', error);
            return [];
        }
    }

    /**
     * Extract device information from user agent
     */
    static getDeviceInfo(userAgent) {
        if (!userAgent) return 'Unknown device';

        const parser = new UAParser(userAgent);
        const result = parser.getResult();

        return {
            browser: `${result.browser.name || 'Unknown'} ${result.browser.version || ''}`,
            os: `${result.os.name || 'Unknown'} ${result.os.version || ''}`,
            device: result.device.vendor
                ? `${result.device.vendor} ${result.device.model}`
                : 'Desktop/Laptop',
            deviceType: result.device.type || 'desktop'
        };
    }

    /**
     * Generate JWT tokens and store them
     */
    static async generateJWT(user, options = {}) {
        try {
            const payload = {
                id: user.id || user._id.toString(),
                role: user.role,
                email: user.email
            };

            const accessToken = jwt.sign(payload, accessSecret, {
                expiresIn: accessExpires,
                algorithm: 'HS256',
            });

            const refreshPayload = {
                id: user.id || user._id.toString(),
                authMethod: options.authMethod || user.preferredAuthMethod
            };

            const refreshToken = jwt.sign(refreshPayload, refreshSecret, {
                expiresIn: refreshExpires,
                algorithm: 'HS256',
            });

            // Get device info
            const deviceInfo = AuthController.getDeviceInfo(options.userAgent);
            const deviceString = `${deviceInfo.browser} on ${deviceInfo.os} (${deviceInfo.device})`;

            // Store refresh token in database
            await RefreshToken.findOneAndUpdate(
                {userId: user.id || user._id.toString()},
                {
                    token: refreshToken,
                    userAgent: options.userAgent || null,
                    ip: options.ip || null,
                    device: deviceString,
                    authMethod: options.authMethod || user.preferredAuthMethod
                },
                {upsert: true, new: true}
            );

            // Add session token to user
            const {AAngBase} = await getModels();
            await AAngBase.updateOne(
                {_id: user.id || user._id.toString()},
                {
                    $push: {
                        sessionTokens: {
                            $each: [{
                                token: accessToken,
                                device: deviceString,
                                ip: options.ip || null,
                                createdAt: new Date(),
                                lastActive: new Date()
                            }],
                            $position: 0,  // Add to beginning (most recent first)
                            $slice: 7       // Keep only 7 total tokens
                        }
                    }
                }
            );

            return {accessToken, refreshToken};
        } catch (error) {
            console.error('JWT generation error:', error);
            throw new Error('Failed to generate authentication tokens');
        }
    }

    /**
     * Social sign-in/sign-up with Google
     */
    static async socialSignIn(req, res) {
        const {tokenResponse, provider, role} = req.body;

        if (!tokenResponse || !provider || !role) {
            return res.status(400).json({error: 'Invalid request: Missing requirements'});
        }

        // Only support Google for now (can be extended to Apple later)
        if (provider !== 'Google') {
            return res.status(400).json({error: 'Unsupported provider'});
        }

        const {idToken} = tokenResponse;
        const roleCapitalized = role.charAt(0).toUpperCase() + role.slice(1);

        try {
            await dbClient.connect();

            // Verify Google token
            const userInfo = await AuthController.verifyGoogleIdToken(idToken);
            const {email, name, picture, googleId} = userInfo;

            const {AAngBase} = await getModels();
            let user = await AAngBase.findOne({email: email.toLowerCase()});

            if (user) {
                // Check if this Google account is already linked
                const hasGoogleAuth = user.authMethods?.some(
                    method => method.type === 'Google' && method.providerId === googleId
                );

                if (hasGoogleAuth) {
                    // User already has this Google account linked - normal login

                    // Update last used timestamp for this auth method
                    const authMethodIndex = user.authMethods.findIndex(
                        m => m.type === 'Google' && m.providerId === googleId
                    );

                    if (authMethodIndex !== -1) {
                        user.authMethods[authMethodIndex].lastUsed = new Date();
                        user.preferredAuthMethod = 'Google';
                        await user.save();
                    }
                } else {
                    // User exists but doesn't have this Google account linked

                    // Check if this Google ID is linked to another account
                    const conflictUser = await AAngBase.findOne({
                        'authMethods': {
                            $elemMatch: {
                                type: 'Google',
                                providerId: googleId
                            }
                        }
                    });

                    if (conflictUser) {
                        return res.status(409).json({
                            error: 'This Google account is already linked to another user',
                            suggestion: 'Please use another Google account or login with your credentials'
                        });
                    }

                    // 🔥 NEW LOGIC: Auto-link Google account to existing credentials-based account
                    // Since email matches and Google ID is not used elsewhere, we can safely link them

                    // Add Google authentication method to existing user
                    user.authMethods.push({
                        type: 'Google',
                        providerId: googleId,
                        verified: true,
                        lastUsed: new Date()
                    });

                    // Update user profile with Google info if not already set
                    if (!user.fullName && name) {
                        user.fullName = name;
                    }
                    if (!user.avatar && picture) {
                        user.avatar = picture;
                    }

                    // Set Google as preferred method for this login
                    user.preferredAuthMethod = 'Google';

                    // Mark email as verified (since Google emails are verified)
                    user.emailVerified = true;

                    // Save the updated user
                    await user.save();

                    console.log(`Google account successfully linked to existing user: ${email}`);
                }
            } else {
                // New user - create account with Google auth
                user = await AAngBase.create({
                    email: email.toLowerCase(),
                    fullName: name,
                    avatar: picture,
                    authMethods: [{
                        type: 'Google',
                        providerId: googleId,
                        verified: true,
                        lastUsed: new Date()
                    }],
                    preferredAuthMethod: 'Google',
                    provider: 'Google', // for backward compatibility
                    role: roleCapitalized,
                    emailVerified: true // Google emails are verified
                });
            }

            // Generate tokens for the user
            const {accessToken, refreshToken} = await AuthController.generateJWT(user, {
                userAgent: req.headers['user-agent'],
                ip: req.ip,
                authMethod: 'Google'
            });

            // get userDashboard data
            const userDashboard = await AuthController.userDashBoardData(user)

            return res.status(201).json({
                accessToken,
                refreshToken,
                user: userDashboard,
                expiresIn: accessExpiresMs
            });

        } catch (err) {
            console.error('Social sign-in error:', err);
            return res.status(401).json({error: 'Invalid Google token or authentication failed'});
        }
    }



    static async firebaseSocialSignIn(req, res) {
        const { firebaseIdToken, provider, role, email, name, picture } = req.body;

        if (!firebaseIdToken || !provider || !role) {
            return res.status(400).json({ error: 'Invalid request: Missing requirements' });
        }

        if (provider !== 'Google') {
            return res.status(400).json({ error: 'Unsupported provider' });
        }

        try {
            await dbClient.connect();

            // Verify Firebase ID token
            const decodedToken = await admin.auth().verifyIdToken(firebaseIdToken);
            const { uid: firebaseUid, email: firebaseEmail } = decodedToken;

            // Use email from token (more secure)
            const userEmail = (firebaseEmail || email).toLowerCase();
            const roleCapitalized = role.charAt(0).toUpperCase() + role.slice(1);

            const { AAngBase } = await getModels();
            let user = await AAngBase.findOne({ email: userEmail });

            if (user) {
                // Check if Firebase auth is already linked
                const hasFirebaseAuth = user.authMethods?.some(
                    method => method.type === 'Google' && method.providerId === firebaseUid
                );

                if (hasFirebaseAuth) {
                    // Update last used
                    const authMethodIndex = user.authMethods.findIndex(
                        m => m.type === 'Google' && m.providerId === firebaseUid
                    );

                    if (authMethodIndex !== -1) {
                        user.authMethods[authMethodIndex].lastUsed = new Date();
                        user.preferredAuthMethod = 'Google';
                        await user.save();
                    }
                } else {
                    // Check for conflicts
                    const conflictUser = await AAngBase.findOne({
                        'authMethods': {
                            $elemMatch: {
                                type: 'Google',
                                providerId: firebaseUid
                            }
                        }
                    });

                    if (conflictUser) {
                        return res.status(409).json({
                            error: 'This Google account is already linked to another user'
                        });
                    }

                    // Link Google account to existing user
                    user.authMethods.push({
                        type: 'Google',
                        providerId: firebaseUid,
                        verified: true,
                        lastUsed: new Date()
                    });

                    if (!user.fullName && name) user.fullName = name;
                    if (!user.avatar && picture) user.avatar = picture;

                    user.preferredAuthMethod = 'Google';
                    user.emailVerified = true;
                    await user.save();

                    console.log(`Google account linked to existing user: ${userEmail}`);
                }
            } else {
                // Create new user
                user = await AAngBase.create({
                    email: userEmail,
                    fullName: name,
                    avatar: picture,
                    authMethods: [{
                        type: 'Google',
                        providerId: firebaseUid,
                        verified: true,
                        lastUsed: new Date()
                    }],
                    preferredAuthMethod: 'Google',
                    provider: 'Google',
                    role: roleCapitalized,
                    emailVerified: true
                });
            }

            // Generate your JWT tokens
            const { accessToken, refreshToken } = await AuthController.generateJWT(user, {
                userAgent: req.headers['user-agent'],
                ip: req.ip,
                authMethod: 'Google'
            });

            const userDashboard = await AuthController.userDashBoardData(user);

            return res.status(201).json({
                accessToken,
                refreshToken,
                user: userDashboard,
                expiresIn: accessExpiresMs
            });

        } catch (err) {
            console.error('Firebase social sign-in error:', err);
            return res.status(401).json({
                error: 'Invalid Firebase token or authentication failed',
                details: err.message
            });
        }
    }

    /**
     * Verify Google ID token
     */
    static async verifyGoogleIdToken(idToken) {
        try {
            const ticket = await client.verifyIdToken({
                idToken,
                audience: process.env.GOOGLE_CLIENT_ID,
            });

            const payload = ticket.getPayload();

            return {
                email: payload.email,
                name: payload.name,
                picture: payload.picture,
                googleId: payload.sub,
            };
        } catch (error) {
            console.error('Google token verification failed:', error);
            throw new Error('Invalid Google token');
        }
    }

    /**
     * Link a social provider to an existing account
     */
    static async linkProvider(req, res) {
        const {tokenResponse, provider} = req.body;
        const userId = req.user.id;

        if (!tokenResponse || !provider) {
            return res.status(400).json({error: 'Missing required fields'});
        }

        // Only support Google for now
        if (provider !== 'Google') {
            return res.status(400).json({error: 'Unsupported provider'});
        }

        try {
            const {idToken} = tokenResponse;
            const userInfo = await AuthController.verifyGoogleIdToken(idToken);
            const {email, googleId} = userInfo;

            // Get user from database
            const {AAngBase} = await getModels();
            const user = await AAngBase.findById(userId);

            if (!user) {
                return res.status(404).json({error: 'User not found'});
            }

            // Check if emails match
            if (user.email.toLowerCase() !== email.toLowerCase()) {
                return res.status(400).json({
                    error: 'The email associated with this Google account does not match your current account email'
                });
            }

            // Check if this Google account is already linked to another user
            const existingUser = await AAngBase.findOne({
                'authMethods': {
                    $elemMatch: {
                        type: 'Google',
                        providerId: googleId
                    }
                }
            });

            if (existingUser && existingUser._id.toString() !== userId) {
                return res.status(409).json({
                    error: 'This Google account is already linked to another user'
                });
            }

            // Check if user already has this provider linked
            const hasProvider = user.authMethods?.some(
                method => method.type === 'Google' && method.providerId === googleId
            );

            if (hasProvider) {
                return res.status(400).json({error: 'This Google account is already linked to your account'});
            }

            // Add the new auth method
            if (!user.authMethods) {
                user.authMethods = [];
            }

            user.authMethods.push({
                type: 'Google',
                providerId: googleId,
                verified: true,
                lastUsed: new Date()
            });

            await user.save();

            return res.status(200).json({
                message: 'Google account linked successfully',
                authMethods: user.authMethods.map(am => am.type)
            });

        } catch (err) {
            console.error('Provider linking error:', err);
            return res.status(500).json({error: 'Failed to link provider'});
        }
    }

    /**
     * Unlink a social provider from account
     */
    static async unlinkProvider(req, res) {
        const {provider} = req.body;
        const userId = req.user.id;

        if (!provider) {
            return res.status(400).json({error: 'Provider is required'});
        }

        try {
            const {AAngBase} = await getModels();
            const user = await AAngBase.findById(userId);

            if (!user) {
                return res.status(404).json({error: 'User not found'});
            }

            // Check if user has this provider
            const hasProvider = user.authMethods?.some(method => method.type === provider);

            if (!hasProvider) {
                return res.status(400).json({error: `No ${provider} account linked`});
            }

            // Prevent removal of last authentication method
            if (user.authMethods.length === 1) {
                return res.status(400).json({
                    error: 'Cannot remove the only authentication method. Add another method before removing this one.'
                });
            }

            // Remove the provider
            user.authMethods = user.authMethods.filter(method => method.type !== provider);

            // Update preferred auth method if needed
            if (user.preferredAuthMethod === provider) {
                user.preferredAuthMethod = user.authMethods[0].type;
            }

            await user.save();

            return res.status(200).json({
                message: `${provider} account unlinked successfully`,
                authMethods: user.authMethods.map(am => am.type),
                preferredAuthMethod: user.preferredAuthMethod
            });

        } catch (err) {
            console.error('Provider unlinking error:', err);
            return res.status(500).json({error: 'Failed to unlink provider'});
        }
    }

    /**
     * Set preferred authentication method
     */
    static async setPreferredAuthMethod(req, res) {
        const {method} = req.body;
        const userId = req.user.id;

        if (!method) {
            return res.status(400).json({error: 'Authentication method is required'});
        }

        try {
            const {AAngBase} = await getModels();
            const user = await AAngBase.findById(userId);

            if (!user) {
                return res.status(404).json({error: 'User not found'});
            }

            // Check if user has this auth method
            const hasMethod = user.authMethods?.some(m => m.type === method);

            if (!hasMethod) {
                return res.status(400).json({
                    error: `You don't have a ${method} authentication method linked to your account`
                });
            }

            // Update preferred method
            user.preferredAuthMethod = method;
            await user.save();

            return res.status(200).json({
                message: `${method} set as preferred authentication method`,
                preferredAuthMethod: method
            });

        } catch (err) {
            console.error('Set preferred auth method error:', err);
            return res.status(500).json({error: 'Failed to update preferred authentication method'});
        }
    }

    /**
     * Intelligent token rotation - only rotate RT when close to expiry
     * @param {Object} user - User object
     * @param {string} authMethod - Authentication method
     * @param {Object} decodedRefreshToken - Decoded refresh token payload
     * @param {Object} storedRefreshToken - Stored refresh token from DB
     * @returns {Object} - { accessToken, refreshToken, rotated }
     */
    static async intelligentTokenRotation(user, authMethod, decodedRefreshToken, storedRefreshToken) {
        try {
            // Always generate a new access token
            const newAccessToken = jwt.sign(
                {
                    id: user._id,
                    role: user.role,
                    email: user.email
                },
                accessSecret,
                {
                    expiresIn: accessExpires,
                    algorithm: 'HS256'
                }
            );

            // Check if refresh token needs rotation
            const shouldRotate = AuthController.shouldRotateRefreshToken(decodedRefreshToken);

            let newRefreshToken = null;
            let rotated = false;

            if (shouldRotate) {
                console.log('🔄 Rotating refresh token due to approaching expiry');

                // Generate new refresh token
                newRefreshToken = jwt.sign(
                    {
                        id: user._id,
                        authMethod
                    },
                    refreshSecret,
                    {
                        expiresIn: refreshExpires,
                        algorithm: 'HS256'
                    }
                );

                // Update the stored refresh token with new token and expiry
                storedRefreshToken.token = newRefreshToken;
                storedRefreshToken.expiresAt = new Date(Date.now() + ms(refreshExpires));
                storedRefreshToken.lastUsed = new Date();
                await storedRefreshToken.save();

                rotated = true;
                console.log('✅ Refresh token successfully rotated');
            } else {
                // Just update the last used timestamp
                storedRefreshToken.lastUsed = new Date();
                await storedRefreshToken.save();

                console.log('ℹ️ Refresh token still valid, only updating lastUsed timestamp');
            }

            return {
                accessToken: newAccessToken,
                refreshToken: newRefreshToken, // null if not rotated
                rotated
            };

        } catch (error) {
            console.error('❌ Intelligent token rotation error:', error);
            throw new Error('Failed to rotate tokens');
        }
    }

    /**
     * Enhanced refresh token rotation logic
     * @param {Object} decodedRefresh - The decoded refresh token payload
     * @param {number} rotationThreshold - Hours before expiry to rotate (default: 24)
     * @returns {boolean} - Whether token should be rotated
     */
    static async shouldRotateRefreshToken(decodedRefresh, rotationThreshold = 24) {
        if (!decodedRefresh || !decodedRefresh.exp) {
            console.log('⚠️ Invalid refresh token payload for rotation check');
            return false;
        }

        const currentTime = Math.floor(Date.now() / 1000); // Current time in seconds
        const timeLeft = decodedRefresh.exp - currentTime; // Time left in seconds
        const hoursLeft = timeLeft / 3600; // Convert to hours

        console.log(`🕐 Refresh token has ${hoursLeft.toFixed(2)} hours left`);

        // Rotate if less than threshold hours left
        const shouldRotate = hoursLeft <= rotationThreshold;

        if (shouldRotate) {
            console.log(`🔄 Refresh token will be rotated (${hoursLeft.toFixed(2)}h < ${rotationThreshold}h threshold)`);
        } else {
            console.log(`✅ Refresh token is still fresh (${hoursLeft.toFixed(2)}h > ${rotationThreshold}h threshold)`);
        }

        return shouldRotate;
    }

    /**
     * Enhanced refresh token handler with intelligent rotation
     */
    static async refreshToken(req, res) {
        try {
            const authHeader = req.headers.authorization;
            const {refreshToken} = req.body;

            if (!refreshToken) {
                return res.status(400).json({error: 'Refresh token required in body'});
            }

            // Extract and verify access token (for session tracking)
            const oldAccessToken = AuthController.extractAccessToken(authHeader);
            let decodedAccess;


            try {
                decodedAccess = AuthController.verifyAccessToken(oldAccessToken);
            } catch (error) {
                // Access token is expired/invalid - this is expected in refresh scenarios
                console.log('ℹ️ Access token invalid/expired during refresh - this is normal');
            }

            // Verify refresh token JWT
            let decodedRefresh;
            try {
                decodedRefresh = AuthController.verifyRefreshToken(refreshToken);
            } catch (jwtError) {
                // Handle expired JWT with cleanup
                if (jwtError.name === 'TokenExpiredError') {
                    await AuthController.cleanupExpiredToken(refreshToken);
                    return res.status(401).json({error: 'Refresh token expired'});
                }
                return res.status(401).json({error: 'Invalid refresh token'});
            }

            if (!decodedRefresh || !decodedRefresh.id) {
                return res.status(401).json({error: 'Invalid refresh token'});
            }

            // Validate refresh token in database
            const storedRefreshToken = await AuthController.validateRefreshTokenInDB(
                decodedRefresh.id,
                refreshToken
            );

            if (!storedRefreshToken) {
                console.log('❌ Refresh token not found or expired in database');
                return res.status(403).json({error: 'Refresh token not found or revoked'});
            }

            // Get user information
            const {AAngBase} = await getModels();
            const user = await AAngBase.findById(decodedRefresh.id);

            if (!user) {
                console.log('❌ User not found for refresh token');
                return res.status(404).json({error: 'User not found'});
            }

            // Check user status
            if (['inactive', 'suspended', 'banned'].includes(user.status.toLowerCase())) {
                // we can do something extra here maybe -- like deleting that refreshToken from the db -- later
                return res.status(403).json({error: 'User account is not active'});
            }

            // Perform intelligent token rotation
            const authMethod = decodedRefresh.authMethod || user.preferredAuthMethod;
            const {
                accessToken,
                refreshToken: newRefreshToken,
                rotated
            } = await AuthController.intelligentTokenRotation(
                user,
                authMethod,
                decodedRefresh,
                storedRefreshToken
            );

            // Update session tracking if we have valid access token info
            if (decodedAccess && decodedAccess.id) {
                await AAngBase.updateOne(
                    {
                        _id: decodedAccess.id,
                        'sessionTokens.token': oldAccessToken
                    },
                    {
                        $set: {'sessionTokens.$.lastActive': new Date()}
                    }
                );
            }

            // Add new session token for the new access token
            const deviceInfo = AuthController.getDeviceInfo(req.headers['user-agent']);
            const deviceString = `${deviceInfo.browser} on ${deviceInfo.os} (${deviceInfo.device})`;

            await AAngBase.updateOne(
                {_id: user._id},
                {
                    $push: {
                        sessionTokens: {
                            $each: [{
                                token: accessToken,
                                device: deviceString,
                                ip: req.ip || null,
                                createdAt: new Date(),
                                lastActive: new Date()
                            }],
                            $position: 0,  // Add to beginning
                            $slice: 7      // Keep only 7 total
                        }
                    }
                }
            );

            // Prepare response
            const response = {
                accessToken,
                refreshToken: rotated ? newRefreshToken : null, // Only include if rotated
                expiresIn: accessExpiresMs,
                message: rotated ? 'Tokens refreshed and rotated' : 'Access token refreshed'

            };

            console.log(`✅ Token refresh successful for user ${user.email} (rotated: ${rotated})`);

            return res.status(200).json(response);

        } catch (err) {
            console.log('❌ [RefreshToken Error]', err.message);
            return res.status(401).json({error: 'Invalid or expired tokens'});
        }
    }

    /**
     * Clean up expired token when JWT verification fails
     */
    static async cleanupExpiredToken(refreshToken) {
        try {
            const decoded = jwt.decode(refreshToken); // Decode without verification
            if (decoded && decoded.id) {
                const result = await RefreshToken.deleteOne({
                    userId: decoded.id,
                    token: refreshToken
                });
                console.log(`🗑️ Cleaned up expired refresh token (deleted: ${result.deletedCount})`);
            }
        } catch (cleanupErr) {
            console.error('Error cleaning up expired refresh token:', cleanupErr.message);
        }
    }

    /**
     * Extract access token from Authorization header
     */
    static extractAccessToken(authHeader) {
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            throw new Error('Missing or malformed Authorization header');
        }
        return authHeader.split(' ')[1];
    }

    /**
     * Verify access token
     */
    static verifyAccessToken(token) {
        try {
            return jwt.verify(token, accessSecret, {ignoreExpiration: true});
        } catch (err) {
            throw new Error('Invalid access token');
        }
    }

    /**
     * Verify access token
     */
    static async verifySocketAccessToken(token) {
        try {
            const decoded = jwt.verify(token, accessSecret);
            if (!decoded || !decoded.id) {
                throw new Error('Invalid access token payload');
            }

            const {AAngBase} = await getModels();
            const user = await AAngBase.findById(decoded.id);

            if (!user) {
                throw new Error('User not found');
            }

            if (['inactive', 'suspended'].includes(user.status)) {
                throw new Error('User is not allowed to connect');
            }

            return user;
        } catch (err) {
            console.error('Socket token verification failed:', err.message);
            throw err;
        }
    }

    /**
     * Verify refresh token
     */
    static verifyRefreshToken(token, expiryFlag = false) {
        try {
            if (expiryFlag) {
                // If expiryFlag is true, ignore expiration for this verification
                return jwt.verify(token, refreshSecret, {ignoreExpiration: true});
            }
            return jwt.verify(token, refreshSecret);
        } catch (err) {
            throw new Error('Invalid refresh token');
        }
    }

    /**
     * Validate refresh token in database with better error handling
     */
    static async validateRefreshTokenInDB(userId, token) {
        try {
            const refreshToken = await RefreshToken.findOne({userId, token}).populate('userId');

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

            return refreshToken;
        } catch (error) {
            console.error('Error finding valid token:', error);
            return null;
        }
    }

    /**
     * Clean up expired refresh tokens manually (optional cleanup job)
     */
    static async cleanupExpiredTokens() {
        try {
            const result = await RefreshToken.deleteMany({
                expiresAt: {$lt: new Date()}
            });
            console.log(`Cleaned up ${result.deletedCount} expired refresh tokens`);
            return result.deletedCount;
        } catch (error) {
            console.error('Error cleaning up expired tokens:', error);
            return 0;
        }
    }

    /**
     * Api PreCheck before any sensitive request
     */
    static async apiPreCheck(req) {
        try {
            const authHeader = req.headers.authorization;

            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                return {
                    success: false,
                    error: 'Missing or malformed Authorization header',
                    statusCode: 401
                };
            }

            const accessToken = authHeader.split(' ')[1];
            if (!accessToken) {
                return {
                    success: false,
                    error: 'Missing access token',
                    statusCode: 401
                };
            }

            // Verify access token with expiration check
            let decodedAccess;
            try {
                decodedAccess = jwt.verify(accessToken, accessSecret);
            } catch (err) {
                // Check if it's specifically an expiration error
                if (err.name === 'TokenExpiredError') {
                    return {
                        success: false,
                        error: 'Access token expired', // ✅ Matches FE .includes("expired")
                        statusCode: 401,
                        tokenExpired: true // Additional flag for reliability
                    };
                }

                // Other JWT errors (malformed, invalid signature, etc.)
                return {
                    success: false,
                    error: 'Invalid access token',
                    statusCode: 401
                };
            }

            if (!decodedAccess || !decodedAccess.id) {
                return {
                    success: false,
                    error: 'Invalid access token payload',
                    statusCode: 401
                };
            }

            // Optional: Verify user still exists and is active
            const {AAngBase} = await getModels();
            const user = await AAngBase.findById(decodedAccess.id);

            if (!user) {
                return {
                    success: false,
                    error: 'User not found',
                    statusCode: 404
                };
            }

            if (user.status === 'inactive' || user.status === 'suspended') {
                return {
                    success: false,
                    error: 'User account is not active',
                    statusCode: 403
                };
            }

            // Success case - return user data for use in the endpoint
            return {
                success: true,
                userData: user,
                accessToken
            };

        } catch (err) {
            console.error('API PreCheck Error:', err);
            return {
                success: false,
                error: 'Authentication verification failed',
                statusCode: 500
            };
        }
    }

    /**
     * User registration with credentials
     */
    static async signUp(req, res) {
        const {email, password, role} = req.body;

        if (!email || !password || !role) {
            return res.status(400).json({error: 'Missing required fields'});
        }

        const roleCapitalized = role.charAt(0).toUpperCase() + role.slice(1);
        req.body.role = roleCapitalized;

        const validation = await validateSchema(signUpSchema, req.body);
        if (!validation.valid) {
            return res.status(400).json({error: validation.errors.join(', ')});
        }

        try {
            await dbClient.connect();
            const {AAngBase} = await getModels();

            // Check if user already exists
            let user = await AAngBase.findOne({email: email.toLowerCase()});
            if (user) {
                // Get available auth methods
                const authMethods = user.authMethods?.map(am => am.type) || [];

                return res.status(409).json({
                    error: 'User already exists',
                    accountExists: true,
                    availableAuthMethods: authMethods
                });
            }

            // Hash password
            const hashedPassword = await AuthController.hashPassword(password);

            // Create user
            user = await AAngBase.create({
                email: email.toLowerCase(),
                password: hashedPassword,
                role: roleCapitalized,
                authMethods: [{
                    type: 'Credentials',
                    verified: false,
                    lastUsed: new Date()
                }],
                preferredAuthMethod: 'Credentials',
                provider: 'Credentials', // Backward compatibility
            });

            // Generate tokens
            const {accessToken, refreshToken} = await AuthController.generateJWT(user, {
                userAgent: req.headers['user-agent'],
                ip: req.ip,
                authMethod: 'Credentials'
            });

            // get userDashboard data
            const userDashboard = await AuthController.userDashBoardData(user)

            return res.status(201).json({
                accessToken,
                refreshToken,
                user: userDashboard,
                expiresIn: accessExpiresMs,
            });

        } catch (err) {
            console.error('Sign up error:', err);
            return res.status(500).json({error: 'Registration failed'});
        }
    }

    /**
     * User login with credentials
     */
    static async logIn(req, res) {
        const {email, password,} = req.body;

        if (!email || !password) {
            return res.status(400).json({error: 'Email and password are required'});
        }

        const validation = await validateSchema(logInSchema, req.body);

        if (!validation.valid) {
            return res.status(400).json({error: validation.errors.join(', ')});
        }

        try {
            await dbClient.connect();
            const {AAngBase} = await getModels();

            // Find user
            const user = await AAngBase.findOne({email: email.toLowerCase()});

            if (!user) {
                console.log('User not found')
                return res.status(401).json({error: 'Invalid email or password'});
            }

            // Check if user has password auth method
            const hasPasswordAuth = user.authMethods?.some(method => method.type === 'Credentials');

            if (!hasPasswordAuth) {
                // User exists but doesn't have password auth
                const availableAuthMethods = user.authMethods?.map(am => am.type) || [];

                return res.status(401).json({
                    error: 'This account does not use password authentication',
                    accountExists: true,
                    availableAuthMethods
                });
            }

            // Check password
            const isValidPassword = await AuthController.comparePasswords(password, user.password);

            if (!isValidPassword) {
                return res.status(401).json({error: 'Invalid email or password'});
            }

            // Update last used timestamp for credentials auth method
            const credentialsIndex = user.authMethods.findIndex(m => m.type === 'Credentials');
            if (credentialsIndex !== -1) {
                user.authMethods[credentialsIndex].lastUsed = new Date();
                user.preferredAuthMethod = 'Credentials';
                await user.save();
            }

            // Generate tokens
            const {accessToken, refreshToken} = await AuthController.generateJWT(user, {
                userAgent: req.headers['user-agent'],
                ip: req.ip,
                authMethod: 'Credentials'
            });

            // get userDashboard data
            if (user.role === 'Driver') {
                const userDashboard = await DriverController.userDashBoardData(user)

                return res.status(201).json({
                    accessToken,
                    refreshToken,
                    user: userDashboard,
                    expiresIn: accessExpiresMs
                });

            }
            const userDashboard = await AuthController.userDashBoardData(user)

            return res.status(201).json({
                accessToken,
                refreshToken,
                user: userDashboard,
                expiresIn: accessExpiresMs
            });

        } catch (err) {
            console.error('Login error:', err);
            return res.status(500).json({error: 'Login failed'});
        }
    }

    /**
     * Log out user and invalidate tokens
     */
    static async signOut(req, res) {

        try {
            const userId = req.user.id;
            const authHeader = req.headers.authorization;

            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                return res.status(400).json({error: 'Missing Authorization header'});
            }

            const token = authHeader.split(' ')[1];

            // Remove refresh token from database
            await RefreshToken.findOneAndDelete({userId});

            // Remove access token from user's sessions
            const {AAngBase} = await getModels();
            await AAngBase.updateOne(
                {_id: userId},
                {$pull: {sessionTokens: {token}}}
            );

            return res.status(200).json({message: 'Logged out successfully'});
        } catch (err) {
            console.error('Logout error:', err);
            return res.status(500).json({error: 'Logout failed'});
        }
    }

    /**
     * Get token
     */
    static async getToken(req, res) {
        // Perform API pre-check
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        // Extract user info from pre-check result
        const {userData} = preCheckResult;
        const userId = userData._id;

        try {
            // Use userData from preCheck if available, otherwise fetch from DB
            let user = userData;
            if (!user) {
                const {AAngBase} = await getModels();
                user = await AAngBase.findById(userId);

                if (!user) {
                    return res.status(404).json({error: 'User not found'});
                }
            }
            const {reqType} = req.body;
            const validReqTypes = ['Email', 'Password'];
            if (!reqType || !validReqTypes.includes(reqType)) {
                return res.status(400).json({error: 'Invalid reqType of token request'});
            }
            // if reqType is Email and Email has already been verified, return error
            if (reqType === 'Email' && user.emailVerified) {
                return res.status(400).json({error: 'Email is already verified'});
            }

            // Generate new verification token
            const verificationToken = AuthController.generateVerificationToken({numericOnly: true});
            // Set token expiry to 15 mins
            const verificationTokenExpiry = Date.now() + 900000; // 15 minutes

            user.emailVerificationToken = verificationToken;
            user.emailVerificationExpiry = verificationTokenExpiry;
            await user.save();

            // Send verification email token
            await MailClient.sendEmailToken(user.email, verificationToken);
            console.log('Operation Successful');

            return res.status(201).json({message: 'Verification Token sent successfully'});
        } catch (err) {
            console.error('Process Error:', err);
            return res.status(500).json({error: err});
        }
    }

    /**
     * Verify email with token
     */
    static async verifyToken(reqType, token) {
        const {AAngBase} = await getModels();

        switch (reqType) {
            case 'Email': {
                const user = await AAngBase.findOne({
                    emailVerificationToken: token,
                    emailVerificationExpiry: {$gt: Date.now()},
                });
                if (!user) throw new Error('Invalid or expired email verification token');
                return user;
            }
            case 'Password': {
                const user = await AAngBase.findOne({
                    resetPasswordToken: token,
                    resetPasswordExpiry: {$gt: Date.now()},
                });
                if (!user) throw new Error('Invalid or expired password reset token');
                return user;
            }
            default:
                throw new Error('Unsupported verification type');
        }
    }

    /**
     * Verify email with token
     */
    static async verifyEmail(req, res) {
        // Perform API pre-check
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }
        const {token, reqType} = req.body;
        if (!token || reqType !== 'Email') {
            return res.status(400).json({error: 'Invalid request format or type'});
        }

        try {
            const user = await AuthController.verifyToken(reqType, token);

            user.emailVerified = true;
            user.emailVerificationToken = undefined;
            user.emailVerificationExpiry = undefined;

            const credentialsIndex = user.authMethods.findIndex(m => m.type === 'Credentials');
            if (credentialsIndex !== -1) {
                user.authMethods[credentialsIndex].verified = true;
            }

            await user.save();

            // get userDashboard data
            const userDashboard = await AuthController.userDashBoardData(user)


            return res.status(201).json({
                message: 'Email verified successfully',
                accessToken: preCheckResult.accessToken,
                user: userDashboard,
                expiresIn: accessExpiresMs
            });
        } catch (err) {
            console.error('Email verification failed:', err.message);
            return res.status(400).json({error: err.message});
        }
    }

    /**
     * Generated random OTP code of alphanumeric characters of length 6
     */
    /**
     * Generates a strong uppercase alphanumeric OTP.
     * Always includes at least 2 letters and 2 digits in a single pass.
     */
    static generateVerificationToken({length = 6, numericOnly = false} = {}) {
        const digits = '0123456789';
        const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

        if (numericOnly) {
            return Array.from({length}, () => digits[Math.floor(Math.random() * digits.length)]).join('');
        }

        if (length < 4) {
            throw new Error('Length must be at least 4 to satisfy 2 letters and 2 digits.');
        }

        // 2 letters
        const tokenParts = [
            ...Array.from({length: 2}, () => letters[Math.floor(Math.random() * letters.length)]),
            ...Array.from({length: 2}, () => digits[Math.floor(Math.random() * digits.length)])
        ];

        // Fill remaining with mixed letters/digits
        const mix = letters + digits;
        const remainingLength = length - tokenParts.length;
        for (let i = 0; i < remainingLength; i++) {
            tokenParts.push(mix[Math.floor(Math.random() * mix.length)]);
        }

        // Shuffle the final array
        for (let i = tokenParts.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [tokenParts[i], tokenParts[j]] = [tokenParts[j], tokenParts[i]];
        }

        return tokenParts.join('');
    }

    /**
     * Request password reset
     */
    static async forgotPasswordToken(req, res) {
        const {email} = req.body;

        if (!email) {
            return res.status(400).json({error: 'Email is required'});
        }

        try {
            const {AAngBase} = await getModels();
            const user = await AAngBase.findOne({email});

            // Don't reveal whether a user with this email exists
            if (!user) {
                return res.status(200).json({message: 'If an account with this email exists, a password reset link has been sent'});
            }

            // Check if user has credentials auth method
            const hasCredentials = user.authMethods?.some(method => method.type === 'Credentials');

            if (!hasCredentials) {
                return res.status(200).json({message: 'If an account with this email exists, a password reset link has been sent'});
            }

            // Generate reset token
            const resetToken = AuthController.generateVerificationToken({length: 5, numericOnly: false});
            const resetTokenExpiry = Date.now() + 3600000; // 1 hour

            user.resetPasswordToken = resetToken;
            user.resetPasswordExpiry = resetTokenExpiry;
            await user.save();

            // Send reset token to email
            await MailClient.passwordResetToken(user.email, resetToken);

            return res.status(201).json({message: 'Password reset token sent'});
        } catch (err) {
            console.error('Forgot password error:', err);
            return res.status(500).json({error: 'Failed to process password reset request'});
        }
    }

    /**
     * Reset password with token
     */
    static async resetPassword(req, res) {
        const {
            email,
            token,
            newPassword,
            confirmPassword,
            reqType,
        } = req.body;

        if (!token || !newPassword || !email || !confirmPassword || !reqType) {
            return res.status(400).json({error: 'Invalid credentials'});
        }
        if (newPassword !== confirmPassword) {
            return res.status(400).json({error: 'New password and confirm password do not match'});
        }
        // ensure token is 5 character wide letters or number + letters
        if (!/^[A-Za-z0-9]{5}$/.test(token)) {
            return res.status(400).json({error: 'Invalid token format'});
        }

        try {
            await resetPasswordSchema.validate(req.body);
            // no api precheck cos its not an authenticated request

            const user = await AuthController.verifyToken('Password', token);
            if (!user) {
                res.status(400).json({error: 'Invalid or expired password reset token'});
            }

            const {AAngBase} = await getModels();

            // ensure the email is from the user
            if (user.email.toLowerCase() !== email.toLowerCase()) {
                return res.status(400).json({error: 'Forbidden request'});
            }

            // Hash and update the new password
            user.password = await AuthController.hashPassword(newPassword);

            // Clear reset token fields
            user.resetPasswordToken = undefined;
            user.resetPasswordExpiry = undefined;

            // Update password change timestamp in Credentials
            const credentialsIndex = user.authMethods.findIndex(m => m.type === 'Credentials');
            if (credentialsIndex !== -1) {
                user.authMethods[credentialsIndex].lastUpdated = new Date();
            }

            await user.save();

            // Invalidate all refresh tokens
            await RefreshToken.deleteMany({userId: user._id});

            // Clear session tokens
            await AAngBase.updateOne(
                {_id: user._id},
                {$set: {sessionTokens: []}}
            );

            return res.status(201).json({message: 'Password reset successfully'});
        } catch (err) {
            const errorMessage = err.name === 'ValidationError' ? err.message : 'Failed to reset password';
            console.error('Reset password error:', err.message);
            return res.status(400).json({error: errorMessage});
        }
    }

    /**
     * Change password (authenticated user)
     */
    static async updatePassword(req, res) {
        // Perform API pre-check
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }
        const {currPassword, newPassword} = req.body;

        if (!currPassword || !newPassword) {
            return res.status(400).json({error: 'Current password and new password are required'});
        }
        const {userData} = preCheckResult;


        try {
            const {AAngBase} = await getModels();
            const user = await AAngBase.findById(userData._id);

            if (!user) {
                return res.status(404).json({error: 'User not found'});
            }

            // Check if user has password auth
            const hasPasswordAuth = user.authMethods?.some(method => method.type === 'Credentials');

            if (!hasPasswordAuth) {
                return res.status(400).json({error: 'This account does not use password authentication'});
            }

            // Verify current password
            const isValidPassword = await AuthController.comparePasswords(currPassword, user.password);

            if (!isValidPassword) {
                return res.status(401).json({error: 'Current password is incorrect'});
            }

            // Update password
            user.password = await AuthController.hashPassword(newPassword);

            // Update password change timestamp in auth methods
            const credentialsIndex = user.authMethods.findIndex(m => m.type === 'Credentials');
            if (credentialsIndex !== -1) {
                user.authMethods[credentialsIndex].lastUpdated = new Date();
            }
            await user.save();

            // Keep current session but invalidate all other sessions
            const authHeader = req.headers.authorization;
            const currentToken = authHeader.split(' ')[1];

            // Invalidate all refresh tokens except current one
            await RefreshToken.deleteMany({
                userId: user._id,
                token: {$ne: req.body.refreshToken} // Keep current refresh token if provided
            });

            // Remove all session tokens except current one
            await AAngBase.updateOne(
                {_id: user._id},
                {$pull: {sessionTokens: {token: {$ne: currentToken}}}}
            );

            // ✅ Trigger notification
            await NotificationService.createNotification({
                userId: user._id,
                type: 'security.password_changed',

            });
            console.log('✅ Notification created for: Password Change');

            return res.status(201).json({message: 'Password changed successfully'});
        } catch (err) {
            console.error('Change password error:', err);
            return res.status(500).json({error: 'Failed to change password'});
        }
    }

    /**
     * Get all active sessions for a user
     */
    static async getSessions(req, res) {
        const userId = req.user.id;

        try {
            const {AAngBase} = await getModels();
            const user = await AAngBase.findById(userId);

            if (!user) {
                return res.status(404).json({error: 'User not found'});
            }

            // Get current session token
            const authHeader = req.headers.authorization;
            const currentToken = authHeader.split(' ')[1];

            // Format sessions
            const sessions = user.sessionTokens.map(session => ({
                id: session._id,
                device: session.device,
                ip: session.ip,
                createdAt: session.createdAt,
                lastActive: session.lastActive,
                current: session.token === currentToken
            }));

            return res.status(200).json({sessions});
        } catch (err) {
            console.error('Get sessions error:', err);
            return res.status(500).json({error: 'Failed to retrieve sessions'});
        }
    }

    /**
     * Revoke a specific session
     */
    static async revokeSession(req, res) {
        const userId = req.user.id;
        const {sessionId} = req.params;

        if (!sessionId) {
            return res.status(400).json({error: 'Session ID is required'});
        }

        try {
            const {AAngBase} = await getModels();

            // Get current session token
            const authHeader = req.headers.authorization;
            const currentToken = authHeader.split(' ')[1];

            // Find user and session
            const user = await AAngBase.findById(userId);

            if (!user) {
                return res.status(404).json({error: 'User not found'});
            }

            const session = user.sessionTokens.id(sessionId);

            if (!session) {
                return res.status(404).json({error: 'Session not found'});
            }

            // Check if trying to revoke current session
            if (session.token === currentToken) {
                return res.status(400).json({error: 'Cannot revoke current session'});
            }

            // Remove session
            await AAngBase.updateOne(
                {_id: userId},
                {$pull: {sessionTokens: {_id: sessionId}}}
            );

            return res.status(200).json({message: 'Session revoked successfully'});
        } catch (err) {
            console.error('Revoke session error:', err);
            return res.status(500).json({error: 'Failed to revoke session'});
        }
    }

    /**
     * Revoke all sessions except current one
     */
    static async revokeAllSessions(req, res) {
        const userId = req.user.id;

        try {
            // Get current session token
            const authHeader = req.headers.authorization;
            const currentToken = authHeader.split(' ')[1];

            const {AAngBase} = await getModels();

            // Keep only current session
            await AAngBase.updateOne(
                {_id: userId},
                {$pull: {sessionTokens: {token: {$ne: currentToken}}}}
            );

            // Invalidate all refresh tokens except current one
            await RefreshToken.deleteMany({
                userId,
                token: {$ne: req.body.refreshToken} // Keep current refresh token if provided
            });

            return res.status(200).json({message: 'All other sessions revoked successfully'});
        } catch (err) {
            console.error('Revoke all sessions error:', err);
            return res.status(500).json({error: 'Failed to revoke sessions'});
        }
    }

    /**
     * Hash password
     */
    static async hashPassword(password) {
        const saltRounds = 10;
        return bcrypt.hash(password, saltRounds);
    }

    /**
     * Compare password with hash
     */
    static async comparePasswords(password, hash) {
        return bcrypt.compare(password, hash);
    }

    // AuthPin Methods to be added to your existing AuthController class

    /**
     * Set AuthPin for user account
     */
    static async setAuthPin(req, res) {
        // Perform API pre-check
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {pin, confirmPin} = req.body;
        const {userData} = preCheckResult;

        if (!pin || !confirmPin) {
            return res.status(400).json({error: 'PIN is required'});
        }

        // Validate PIN format (4-6 digits)
        if (!/^\d{4,6}$/.test(pin)) {
            return res.status(400).json({error: 'PIN must be 4-6 digits'});
        }
        if (!/^\d{4,6}$/.test(confirmPin)) {
            return res.status(400).json({error: 'PIN must be 4-6 digits'});
        }
        // Check if PINs match
        if (pin !== confirmPin) {
            return res.status(400).json({error: 'PINs do not match'});
        }

        try {
            const {AAngBase} = await getModels();
            const user = await AAngBase.findById(userData._id);

            if (!user) {
                return res.status(404).json({error: 'User not found'});
            }

            // Check if user already has AuthPin set
            if (user.authPin && user.authPin.pin) {
                return res.status(400).json({error: 'AuthPin already exists. Use update method to change it.'});
            }

            // Hash the PIN
            const hashedPin = await AuthController.hashPassword(pin);

            // Set AuthPin
            user.authPin = {
                pin: hashedPin,
                isEnabled: true,
                createdAt: new Date(),
                lastUsed: null,
                failedAttempts: 0,
                lockedUntil: null
            };

            // Add AuthPin to auth methods if not already present
            const hasAuthPinMethod = user.authMethods?.some(method => method.type === 'AuthPin');
            if (!hasAuthPinMethod) {
                if (!user.authMethods) user.authMethods = [];
                user.authMethods.push({
                    type: 'AuthPin',
                    verified: true,
                    lastUsed: new Date()
                });
            }

            await user.save();


            // ✅ Trigger notification
            await NotificationService.createNotification({
                userId: user._id,
                type: 'security.pin_set',
            });
            console.log('✅ Notification created for: Auth PIN Set');

            // get userDashboard data
            const userDashboard = await AuthController.userDashBoardData(user)

            return res.status(201).json({
                message: 'AuthPin set successfully',
                user: userDashboard,
            });

        } catch (err) {
            console.error('Set AuthPin error:', err);
            return res.status(500).json({error: 'Failed to set AuthPin'});
        }
    }

    /**
     * Update existing AuthPin
     */
    static async updateAuthPin(req, res) {
        // Perform API pre-check
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {email, token, newPin, reqType, currentPin} = req.body;

        if (!email || !token || !newPin || !reqType || !currentPin) {
            return res.status(400).json({error: 'Invalid credentials'});
        }

        // Validate request type
        if (reqType !== 'updatePin') {
            return res.status(400).json({error: 'Invalid request type'});
        }

        // validate current format
        if (!/^\d{4,6}$/.test(currentPin)) {
            return res.status(400).json({error: 'Invalid PIN'});
        }

        // Validate new PIN format
        if (!/^\d{4,6}$/.test(newPin)) {
            return res.status(400).json({error: 'Invalid PIN'});
        }

        // Validate token format (5 char alphanumeric capitalized)
        if (!/^[A-Z0-9]{5}$/.test(token)) {
            return res.status(400).json({error: 'Invalid token format'});
        }

        // Prevent same PIN
        if (currentPin === newPin) {
            return res.status(400).json({error: 'New PIN must be different from current PIN'});
        }

        const {userData} = preCheckResult;

        try {
            const {AAngBase} = await getModels();
            const user = await AAngBase.findById(userData._id);

            if (!user) {
                return res.status(404).json({error: 'User not found'});
            }

            // Check if AuthPin exists and is enabled
            if (!user.authPin || !user.authPin.pin || !user.authPin.isEnabled) {
                return res.status(400).json({error: 'Forbidden: No AuthPin set or enabled'});
            }

            // Check if AuthPin is locked
            if (user.authPin.lockedUntil && user.authPin.lockedUntil > new Date()) {
                const lockTimeRemaining = Math.ceil((user.authPin.lockedUntil - new Date()) / 1000 / 60);
                return res.status(423).json({
                    error: `AuthPin is locked. Try again in ${lockTimeRemaining} minutes.`
                });
            }

            // Verify current PIN
            const isValidPin = await AuthController.comparePasswords(currentPin, user.authPin.pin);
            if (!isValidPin) {
                // Increment failed attempts
                user.authPin.failedAttempts = (user.authPin.failedAttempts || 0) + 1;

                // Lock if too many failed attempts (5 attempts = 15 min lock)
                if (user.authPin.failedAttempts >= 5) {
                    user.authPin.lockedUntil = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
                    await user.save();
                    return res.status(423).json({
                        error: 'Too many failed attempts. AuthPin locked for 15 minutes.'
                    });
                }

                await user.save();

                return res.status(401).json({
                    error: 'Current PIN is incorrect',
                    attemptsRemaining: 5 - user.authPin.failedAttempts
                });
            }

            // Hash new PIN and update
            user.authPin.pin = await AuthController.hashPassword(newPin);
            user.authPin.failedAttempts = 0;
            user.authPin.lockedUntil = null;
            user.authPin.lastUsed = new Date();

            // Update AuthPin method timestamp
            const authPinIndex = user.authMethods.findIndex(m => m.type === 'AuthPin');
            if (authPinIndex !== -1) {
                user.authMethods[authPinIndex].lastUpdated = new Date();
            } else {
                // Add AuthPin method if it doesn't exist
                user.authMethods.push({
                    type: 'AuthPin',
                    verified: true,
                    lastUsed: new Date()
                });
            }

            // Clear reset token
            user.authPinResetToken = undefined;
            user.authPinResetExpiry = undefined;

            await user.save();

            // ✅ Trigger notification
            await NotificationService.createNotification({
                userId: user._id,
                type: 'security.pin_updated',
            });
            console.log('✅ Notification created for: Auth PIN Updated');

            return res.status(201).json({message: 'AuthPin updated successfully'});

        } catch (err) {
            console.error('Update AuthPin error:', err);
            return res.status(500).json({error: 'Failed to update AuthPin'});
        }
    }

    /**
     * Reset AuthPin (requires email verification)
     */
    static async resetAuthPin(req, res) {
        // Perform API pre-check
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {email, token, newPin, reqType, confirmPin} = req.body;

        if (!email || !token || !newPin || !reqType || !confirmPin) {
            return res.status(400).json({error: 'Invalid credentials'});
        }

        // Validate new PIN format
        if (!/^\d{4,6}$/.test(newPin)) {
            return res.status(400).json({error: 'Invalid PIN'});
        }

        if (!/^\d{4,6}$/.test(confirmPin)) {
            return res.status(400).json({error: 'Invalid PIN'});
        }

        // Validate token format (5 char alphanumeric capitalized)
        if (!/^[A-Z0-9]{5}$/.test(token)) {
            return res.status(400).json({error: 'Invalid token format'});
        }

        if (reqType !== 'resetPin') {
            return res.status(400).json({error: 'Invalid request type'})
        }

        try {
            const {AAngBase} = await getModels();

            // Find user by email and verify token
            const user = await AAngBase.findOne({
                email,
                authPinResetToken: token,
                authPinResetExpiry: {$gt: Date.now()}
            });

            if (!user) {
                return res.status(400).json({error: 'Invalid or expired reset token'});
            }

            // Hash new PIN and reset
            const hashedNewPin = await AuthController.hashPassword(newPin);

            user.authPin = {
                pin: hashedNewPin,
                isEnabled: true,
                createdAt: user.authPin?.createdAt || new Date(),
                lastUsed: new Date(),
                failedAttempts: 0,
                lockedUntil: null
            };

            // Clear reset token
            user.authPinResetToken = undefined;
            user.authPinResetExpiry = undefined;

            // Update AuthPin method
            const authPinIndex = user.authMethods.findIndex(m => m.type === 'AuthPin');
            if (authPinIndex !== -1) {
                user.authMethods[authPinIndex].lastUsed = new Date();
                user.authMethods[authPinIndex].verified = true;
            } else {
                // Add AuthPin method if it doesn't exist
                user.authMethods.push({
                    type: 'AuthPin',
                    verified: true,
                    lastUsed: new Date()
                });
            }

            await user.save();

            // ✅ Trigger notification
            await NotificationService.createNotification({
                userId: user._id,
                type: 'security.pin_reset',
            });
            console.log('✅ Notification created for: Auth PIN Reset');

            return res.status(201).json({message: 'AuthPin reset successfully'});

        } catch (err) {
            console.error('Reset AuthPin error:', err);
            return res.status(500).json({error: 'Failed to reset AuthPin'});
        }
    }

    /**
     * Request AuthPin reset token
     */
    static async requestAuthPinToken(req, res) {
        // Perform API pre-check
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }
        const {email} = req.body;

        if (!email) {
            return res.status(400).json({error: 'Email is required'});
        }

        try {
            const {AAngBase} = await getModels();
            const user = await AAngBase.findOne({email});

            // Don't reveal if user exists
            if (!user) {
                console.log('Error from here');
                return res.status(400).json({
                    error: 'Invalid request'
                });
            }

            // check if the user email is verified
            if (!user.emailVerified) {
                return res.status(401).json({
                    error: 'Unauthorized request'
                })
            }

            // Check if user has AuthPin enabled
            if (!user.authPin || !user.authPin.pin || !user.authPin.isEnabled) {
                return res.status(400).json({
                    message: 'Invalid request'
                });
            }

            // Generate reset token -- mixture of number and letters and of lenthg 8
            const resetToken = AuthController.generateVerificationToken({length: 5});
            const resetTokenExpiry = Date.now() + 3600000; // 1 hour

            user.authPinResetToken = resetToken;
            user.authPinResetExpiry = resetTokenExpiry;
            await user.save();

            // Send reset token via email
            try {
                await MailClient.authResetToken(user.email, resetToken);
            } catch (err) {
                console.log(err);
                return res.status(500).json({error: 'Mail Server internal error'});
            }


            return res.status(201).json({
                message: 'Token sent to the verified associated account'
            });

        } catch (err) {
            console.error('Request AuthPin reset error:', err);
            return res.status(500).json({error: 'Failed to process AuthPin reset request'});
        }
    }

    // might covert this to an internal function and not API base
    /**
     * Verify AuthPin for sensitive operations
     */
    static async verifyAuthPin(req, res) {
        // Perform API pre-check
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {pin, operation} = req.body;
        const {userData} = preCheckResult;

        if (!pin) {
            return res.status(400).json({error: 'PIN is required'});
        }

        if (!operation) {
            return res.status(400).json({error: 'Operation type is required'});
        }

        try {
            const {AAngBase} = await getModels();
            const user = await AAngBase.findById(userData._id);

            if (!user) {
                return res.status(404).json({error: 'User not found'});
            }

            // Check if AuthPin exists and is enabled
            if (!user.authPin || !user.authPin.pin || !user.authPin.isEnabled) {
                return res.status(400).json({error: 'AuthPin is not set or disabled'});
            }

            // Check if AuthPin is locked
            if (user.authPin.lockedUntil && user.authPin.lockedUntil > new Date()) {
                const lockTimeRemaining = Math.ceil((user.authPin.lockedUntil - new Date()) / 1000 / 60);
                return res.status(423).json({
                    error: `AuthPin is locked. Try again in ${lockTimeRemaining} minutes.`
                });
            }

            // Verify PIN
            const isValidPin = await AuthController.comparePasswords(pin, user.authPin.pin);
            if (!isValidPin) {
                // Increment failed attempts
                user.authPin.failedAttempts = (user.authPin.failedAttempts || 0) + 1;

                // Lock if too many failed attempts
                if (user.authPin.failedAttempts >= 5) {
                    user.authPin.lockedUntil = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
                    await user.save();
                    return res.status(423).json({
                        error: 'Too many failed attempts. AuthPin locked for 15 minutes.'
                    });
                }

                await user.save();
                return res.status(401).json({
                    error: 'Invalid PIN',
                    attemptsRemaining: 5 - user.authPin.failedAttempts
                });
            }

            // PIN is valid - reset failed attempts and update last used
            user.authPin.failedAttempts = 0;
            user.authPin.lockedUntil = null;
            user.authPin.lastUsed = new Date();

            // Update AuthPin method timestamp
            const authPinIndex = user.authMethods.findIndex(m => m.type === 'AuthPin');
            if (authPinIndex !== -1) {
                user.authMethods[authPinIndex].lastUsed = new Date();
            }

            await user.save();

            // Generate verification token for the operation (valid for 10 minutes)
            const verificationToken = jwt.sign(
                {
                    userId: user._id,
                    operation,
                    verified: true,
                    verifiedAt: new Date()
                },
                accessSecret,
                {expiresIn: '10m'}
            );

            return res.status(200).json({
                message: 'AuthPin verified successfully',
                verificationToken,
                operation,
                expiresIn: 600000 // 10 minutes in milliseconds
            });

        } catch (err) {
            console.error('Verify AuthPin error:', err);
            return res.status(500).json({error: 'Failed to verify AuthPin'});
        }
    }

    /**
     * Enable/Disable AuthPin
     */
    static async toggleAuthPin(req, res) {
        // Perform API pre-check
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {enable, pin} = req.body;
        const {userData} = preCheckResult;

        if (typeof enable !== 'boolean') {
            return res.status(400).json({error: 'Enable flag is required (true/false)'});
        }

        try {
            const {AAngBase} = await getModels();
            const user = await AAngBase.findById(userData._id);

            if (!user) {
                return res.status(404).json({error: 'User not found'});
            }

            // Check if AuthPin exists
            if (!user.authPin || !user.authPin.pin) {
                return res.status(400).json({error: 'No AuthPin set. Use set method first.'});
            }

            if (enable) {
                // Enabling - verify current PIN
                if (!pin) {
                    return res.status(400).json({error: 'PIN is required to enable AuthPin'});
                }

                const isValidPin = await AuthController.comparePasswords(pin, user.authPin.pin);
                if (!isValidPin) {
                    return res.status(401).json({error: 'Invalid PIN'});
                }

                user.authPin.isEnabled = true;
                user.authPin.lastUsed = new Date();
            } else {
                // Disabling
                user.authPin.isEnabled = false;
            }

            await user.save();

            return res.status(200).json({
                message: `AuthPin ${enable ? 'enabled' : 'disabled'} successfully`,
                isEnabled: user.authPin.isEnabled
            });

        } catch (err) {
            console.error('Toggle AuthPin error:', err);
            return res.status(500).json({error: 'Failed to toggle AuthPin'});
        }
    }

    /**
     * Remove AuthPin completely
     */
    static async removeAuthPin(req, res) {
        // Perform API pre-check
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {pin, password} = req.body;
        const {userData} = preCheckResult;

        // Require either PIN or password for security
        if (!pin && !password) {
            return res.status(400).json({error: 'Either current PIN or account password is required'});
        }

        try {
            const {AAngBase} = await getModels();
            const user = await AAngBase.findById(userData._id);

            if (!user) {
                return res.status(404).json({error: 'User not found'});
            }

            // Check if AuthPin exists
            if (!user.authPin || !user.authPin.pin) {
                return res.status(400).json({error: 'No AuthPin set'});
            }

            let isAuthorized = false;

            // Verify with PIN if provided
            if (pin) {
                isAuthorized = await AuthController.comparePasswords(pin, user.authPin.pin);
            }

            // Verify with password if PIN verification failed or wasn't provided
            if (!isAuthorized && password && user.password) {
                isAuthorized = await AuthController.comparePasswords(password, user.password);
            }

            if (!isAuthorized) {
                return res.status(401).json({error: 'Invalid PIN or password'});
            }

            // Remove AuthPin
            user.authPin = undefined;

            // Remove AuthPin from auth methods
            user.authMethods = user.authMethods.filter(method => method.type !== 'AuthPin');

            // Update preferred auth method if it was AuthPin
            if (user.preferredAuthMethod === 'AuthPin') {
                user.preferredAuthMethod = user.authMethods.length > 0 ? user.authMethods[0].type : 'Credentials';
            }

            await user.save();

            return res.status(200).json({
                message: 'AuthPin removed successfully',
                authMethods: user.authMethods.map(am => am.type),
                preferredAuthMethod: user.preferredAuthMethod
            });

        } catch (err) {
            console.error('Remove AuthPin error:', err);
            return res.status(500).json({error: 'Failed to remove AuthPin'});
        }
    }

    /**
     * Get AuthPin status and info
     */
    static async getAuthPinStatus(req, res) {
        // Perform API pre-check
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {userData} = preCheckResult;

        try {
            const {AAngBase} = await getModels();
            const user = await AAngBase.findById(userData._id);

            if (!user) {
                return res.status(404).json({error: 'User not found'});
            }

            const authPinStatus = {
                hasAuthPin: !!(user.authPin && user.authPin.pin),
                isEnabled: user.authPin?.isEnabled || false,
                createdAt: user.authPin?.createdAt || null,
                lastUsed: user.authPin?.lastUsed || null,
                isLocked: user.authPin?.lockedUntil ? user.authPin.lockedUntil > new Date() : false,
                lockExpiresAt: user.authPin?.lockedUntil || null,
                failedAttempts: user.authPin?.failedAttempts || 0
            };

            return res.status(200).json({
                authPin: authPinStatus
            });

        } catch (err) {
            console.error('Get AuthPin status error:', err);
            return res.status(500).json({error: 'Failed to get AuthPin status'});
        }
    }

    static async acceptTCs(req, res) {
        // Perform API pre-check
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {acceptedTcs} = req.body;
        if (typeof acceptedTcs !== 'boolean') {
            return res.status(400).json({error: 'acceptedTcs must be a boolean'});
        }
        if (!acceptedTcs) {
            return res.status(400).json({error: 'You must accept the terms and conditions'});
        }
        const {userData} = preCheckResult;
        try {
            const {AAngBase} = await getModels();
            const user = await AAngBase.findById(userData._id);

            if (!user) {
                return res.status(404).json({error: 'User not found'});
            }

            // set tcs to true
            user.tcs.isAccepted = true
            user.tcs.acceptedAt = new Date();

            await user.save();

            // get userDashboard data
            const userDashboard = await AuthController.userDashBoardData(user)

            return res.status(201).json({
                message: 'Terms accepted',
                user: userDashboard,
            });
        } catch (err) {
            console.error('Change password error:', err);
            return res.status(500).json({error: 'Failed to change password'});
        }
    }

    static async userDashBoardData(userObject, flag = null) {
        let orderData;
        const {AAngBase} = await getModels();
        const {Order} = await getOrderModels();
        const user = await AAngBase.findById(userObject._id);

        if (flag) {
            orderData = await Order.findById(userObject._id);
            if (!orderData) {
                orderData = null;
            }
        }

        if (!user) {
            throw new Error('User not found');
        }

        const verificationChecks = {
            Client: () => user.emailVerified === true && user.nin?.verified === true,

            Driver: () => {
                return user.emailVerified === true && user.nin?.verified === true;
                // 🔜 Later extend with license, plate, etc.
                // && user.license?.verified === true
            },

            Admin: () => true, // optional: admin might not need checks
        };

        // Step 2: Determine verification status intelligently
        const isFullyVerified = verificationChecks[user.role]?.() || false;

        return {
            id: user._id.toString(),
            email: user.email,
            name: user.fullName || null,
            avatar: user.avatar || null,
            role: user.role.toLowerCase(),
            emailVerified: user.emailVerified || false,
            address: user.address || null,
            savedLocations: user.savedLocations || [],
            state: user.state || null,
            lga: user.lga || null,
            dob: user.dob ? new Date(user.dob).toISOString() : null,
            fullName: user.fullName || null,
            gender: user.gender || null,
            phoneNumber: user.phoneNumber || null,
            authPin: user.authPin ? {
                isEnabled: user.authPin.isEnabled || null,
            } : null,
            authMethods: user.authMethods.map(method => ({
                type: method.type,
                verified: method.verified,
                lastUsed: method.lastUsed
            })),
            primaryProvider: user.provider || user.preferredAuthMethod,
            tcs: {
                isAccepted: user.tcs?.isAccepted || false,
            },
            ninVerified: user.nin?.verified || false,
            isFullyVerified,
            orderData,
        };
    }

    static async getDashboardData(req, res) {
        // Perform API pre-check
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {userData} = preCheckResult;
        try {
            const {AAngBase} = await getModels();
            const user = await AAngBase.findById(userData._id);

            if (!user) {
                return res.status(404).json({error: 'User not found'});
            }
            // get userDashboard data
            const userDashboard = await AuthController.userDashBoardData(user)
            return res.status(200).json({
                user: userDashboard,
            });
        } catch (err) {
            console.log('Change password error:', err);
            return res.status(500).json({error: 'Failed to change password'});
        }

    }

    // Cloudinary
    static async getSignedUrl(req, res) {
        // Perform API pre-check
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {userData} = preCheckResult;

        try {
            const userId = userData._id.toString();
            const timestamp = Math.floor(Date.now() / 1000);
            const publicId = `AAngLogistics/Avatar/${userId}/profile`;

            const signature = cloudinary.utils.api_sign_request(
                {
                    timestamp,
                    public_id: publicId,
                },
                process.env.CLOUDINARY_API_SECRET
            );

            console.log('Signature sent');

            res.status(200).json({
                timestamp,
                signature,
                public_id: publicId,
                api_key
            });
        } catch (err) {
            console.error('Signature error:', err.message);
            res.status(500).json({error: 'Could not generate signature'});
        }
    }

    // In AuthController
    static async verifyNextAuthSession(webSessionToken) {
        try {
            // The webSessionToken should be the JWT from NextAuth
            const decoded = jwt.verify(webSessionToken, process.env.SOCKET_SECRET);

            // NextAuth typically stores user ID in 'sub' claim
            const userId = decoded.sub || decoded.id;

            if (!userId) {
                throw new Error('Invalid session token: no user ID');
            }

            const {AAngBase} = await getModels();
            const user = await AAngBase.findById(userId);

            if (!user) {
                throw new Error('User not found');
            }

            return user;
        } catch (error) {
            console.error('NextAuth session verification failed:', error);
            throw new Error('Invalid or expired session');
        }
    }
}

export default AuthController;
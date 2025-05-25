import dbClient from "../database/mongoDB";
import ms from 'ms';
import jwt from "jsonwebtoken";
import getModels from "../models/AAng/AAngLogistics";
import RefreshToken from "../models/RefreshToken";
import bcrypt from 'bcrypt';
import {OAuth2Client} from 'google-auth-library';
import redisClient from '../utils/redis';
import nodemailer from 'nodemailer';
import {UAParser} from 'ua-parser-js';
import MailClient from '../utils/mailer';
import {logInSchema, resetPasswordSchema, signUpSchema, validateSchema} from "../validators/validateAuth";

// Environment variables
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const accessSecret = process.env.JWT_ACCESS_SECRET;
const refreshSecret = process.env.JWT_REFRESH_SECRET;
const accessExpires = process.env.JWT_ACCESS_EXPIRES_IN;
const refreshExpires = process.env.JWT_REFRESH_EXPIRES_IN;
const accessExpiresMs = ms(accessExpires);

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
                            token: accessToken,
                            device: deviceString,
                            ip: options.ip || null,
                            createdAt: new Date(),
                            lastActive: new Date()
                        },
                    },
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
        console.log({req});

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
            let user = await AAngBase.findOne({email});

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

                    // Return account exists response - user should login with credentials first
                    return res.status(409).json({
                        error: 'An account with this email already exists',
                        accountExists: true,
                        availableAuthMethods: user.authMethods.map(am => am.type),
                        action: 'login_and_link'
                    });
                }
            } else {
                // New user - create account with Google auth
                user = await AAngBase.create({
                    email,
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

            return res.status(201).json({
                accessToken,
                refreshToken,
                user: {
                    id: user._id,
                    email: user.email,
                    name: user.fullName,
                    avatar: user.avatar,
                    role: user.role.toLowerCase(),
                    authMethods: user.authMethods.map(am => am.type),
                    preferredAuthMethod: user.preferredAuthMethod
                },
                expiresIn: accessExpiresMs
            });

        } catch (err) {
            console.error('Social sign-in error:', err);
            return res.status(401).json({error: 'Invalid Google token or authentication failed'});
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
     * Refresh token handler
     */
    static async refreshToken(req, res) {
        try {
            const authHeader = req.headers.authorization;
            const {refreshToken} = req.body;

            if (!refreshToken) {
                return res.status(400).json({error: 'Refresh token required in body'});
            }

            // Extract and verify tokens
            const oldAccessToken = AuthController.extractAccessToken(authHeader);

            let decodedAccess;
            try {
                decodedAccess = AuthController.verifyAccessToken(oldAccessToken);
            } catch (error) {
                // Continue with refresh token if access token is invalid/expired
            }

            const decodedRefresh = AuthController.verifyRefreshToken(refreshToken);

            if (!decodedRefresh || !decodedRefresh.id) {
                return res.status(401).json({error: 'Invalid refresh token'});
            }

            // Validate token in database
            const stored = await AuthController.validateRefreshTokenInDB(decodedRefresh.id, refreshToken);
            if (!stored) {
                return res.status(403).json({error: 'Refresh token not found or revoked'});
            }

            // Get user information
            const {AAngBase} = await getModels();
            const user = await AAngBase.findById(decodedRefresh.id);

            if (!user) {
                return res.status(404).json({error: 'User not found'});
            }

            // Generate new tokens
            const authMethod = decodedRefresh.authMethod || user.preferredAuthMethod;
            const {accessToken, newRefreshToken} = await AuthController.rotateTokens(user, authMethod);

            // Update refresh token in database
            stored.token = newRefreshToken;
            stored.lastUsed = new Date();
            await stored.save();

            // Update last active for session
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

            return res.status(200).json({
                accessToken,
                refreshToken: newRefreshToken,
                expiresIn: accessExpiresMs,
            });

        } catch (err) {
            console.error('[RefreshToken Error]', err.message);
            return res.status(401).json({error: 'Invalid or expired tokens'});
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
     * Verify refresh token
     */
    static verifyRefreshToken(token) {
        try {
            return jwt.verify(token, refreshSecret);
        } catch (err) {
            throw new Error('Invalid refresh token');
        }
    }

    /**
     * Validate refresh token in database
     */
    static async validateRefreshTokenInDB(userId, token) {
        const stored = await RefreshToken.findOne({userId, token});
        if (!stored) return null;
        if (stored.isExpired()) {
            await stored.remove();
            return null;
        }
        return stored;
    }

    /**
     * Generate new tokens
     */
    static async rotateTokens(user, authMethod) {
        const accessToken = jwt.sign(
            {id: user._id, role: user.role, email: user.email},
            accessSecret,
            {expiresIn: accessExpires, algorithm: 'HS256'}
        );

        const newRefreshToken = jwt.sign(
            {id: user._id, authMethod},
            refreshSecret,
            {expiresIn: refreshExpires, algorithm: 'HS256'}
        );

        return {accessToken, newRefreshToken};
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
            return res.status(400).json({ error: validation.errors.join(', ') });
        }

        try {
            await dbClient.connect();
            const {AAngBase} = await getModels();

            // Check if user already exists
            let user = await AAngBase.findOne({email});
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


            // Generate email verification token [length 6, alphaNumeric]
            const verificationToken = AuthController.generateVerificationToken();
            // Set token expiry to 15 mins
            const verificationTokenExpiry = Date.now() + 900000; // 15 minutes

            // Create user
            user = await AAngBase.create({
                email,
                password: hashedPassword,
                role: roleCapitalized,
                authMethods: [{
                    type: 'Credentials',
                    verified: false,
                    lastUsed: new Date()
                }],
                preferredAuthMethod: 'Credentials',
                provider: 'Credentials', // Backward compatibility
                emailVerificationToken: verificationToken,
                emailVerificationExpiry: verificationTokenExpiry
            });

            await MailClient.sendEmailToken(email, verificationToken);

            // Generate tokens
            const {accessToken, refreshToken} = await AuthController.generateJWT(user, {
                userAgent: req.headers['user-agent'],
                ip: req.ip,
                authMethod: 'Credentials'
            });

            return res.status(201).json({
                accessToken,
                refreshToken,
                user: {
                    id: user._id,
                    email: user.email,
                    name: user.fullName,
                    role: user.role.toLowerCase(),
                    authMethods: ['Credentials'],
                    preferredAuthMethod: 'Credentials',
                    emailVerified: false
                },
                expiresIn: accessExpiresMs,
                message: 'Verification email sent. Please check your inbox.'
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
        const {email, password, role} = req.body;

        if (!email || !password || !role) {
            return res.status(400).json({error: 'Email and password are required'});
        }

        req.body.role = role.charAt(0).toUpperCase() + role.slice(1);

        const validation = await validateSchema(logInSchema, req.body);

        if (!validation.valid) {
            return res.status(400).json({ error: validation.errors.join(', ') });
        }

        try {
            await dbClient.connect();
            const {AAngBase} = await getModels();

            // Find user
            const user = await AAngBase.findOne({email});

            if (!user) {
                return res.status(401).json({error: 'Invalid email or password'});
            }

            // Check if role matches
            if (user.role.toLowerCase() !== role.toLowerCase()) {
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

            return res.status(200).json({
                accessToken,
                refreshToken,
                user: {
                    id: user._id,
                    email: user.email,
                    name: user.fullName,
                    avatar: user.avatar,
                    role: user.role.toLowerCase(),
                    authMethods: user.authMethods.map(am => am.type),
                    preferredAuthMethod: user.preferredAuthMethod,
                    emailVerified: user.emailVerified || false
                },
                expiresIn: accessExpiresMs
            });

        } catch (err) {
            console.error('Sign in error:', err);
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
        const { userData } = preCheckResult;
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
            if (!reqType || (reqType !== 'Email' && reqType !== 'Password')) {
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
                    passwordResetToken: token,
                    passwordResetExpiry: {$gt: Date.now()},
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

            return res.status(200).json({
                message: 'Email verified successfully',
                accessToken: preCheckResult.accessToken,
                user: {
                    id: user._id,
                    email: user.email,
                    name: user.fullName,
                    avatar: user.avatar,
                    role: user.role.toLowerCase(),
                    authMethods: user.authMethods.map(am => am.type),
                    preferredAuthMethod: user.preferredAuthMethod,
                    emailVerified: user.emailVerified || false
                },
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
    static generateVerificationToken({length = 6, numericOnly = false} = {}) {
        const alphaNumChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        const numericChars = '0123456789';
        const chars = numericOnly ? numericChars : alphaNumChars;

        let token = '';
        for (let i = 0; i < length; i++) {
            token += chars[Math.floor(Math.random() * chars.length)];
        }
        return token;
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
            const resetToken = AuthController.generateVerificationToken({numericOnly: true});
            const resetTokenExpiry = Date.now() + 3600000; // 1 hour

            user.passwordResetToken = resetToken;
            user.passwordResetExpiry = resetTokenExpiry;
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

        const {token, newPassword} = req.body;

        if (!token || !newPassword) {
            return res.status(400).json({error: 'Token and new password are required'});
        }

        try {
            await resetPasswordSchema.validate(req.body);

            const user = await AuthController.verifyToken('Password', token);

            const {AAngBase, RefreshToken} = await getModels();

            // Hash and update the new password
            user.password = await AuthController.hashPassword(newPassword);

            // Clear reset token fields
            user.passwordResetToken = undefined;
            user.passwordResetExpiry = undefined;

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
                {_id: user._id },
                {$set: {sessionTokens: []}}
            );

            return res.status(200).json({message: 'Password reset successfully'});
        } catch (err) {
            const errorMessage = err.name === 'ValidationError' ? err.message : 'Failed to reset password';
            console.error('Reset password error:', err.message);
            return res.status(400).json({ error: errorMessage });
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
        const {currentPassword, newPassword} = req.body;

        if (!currentPassword || !newPassword) {
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
            const isValidPassword = await AuthController.comparePasswords(currentPassword, user.password);

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
            return res.status(200).json({message: 'Password changed successfully'});
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
}

export default AuthController;
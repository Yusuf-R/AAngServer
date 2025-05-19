import dbClient from "../database/mongoDB";
import ms from 'ms';
import jwt from "jsonwebtoken";
import getModels from "../models/AAng/AAngLogistics";
import RefreshToken from "../models/RefreshToken";

const bcrypt = require('bcrypt');
const {OAuth2Client} = require('google-auth-library');

const redisClient = require('../utils/redis');
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const accessSecret = process.env.JWT_ACCESS_SECRET;
const refreshSecret = process.env.JWT_REFRESH_SECRET;
const accessExpires = process.env.JWT_ACCESS_EXPIRES_IN;
const refreshExpires = process.env.JWT_REFRESH_EXPIRES_IN;
const accessExpiresMs = ms(accessExpires);
console.log({
    accessExpires,
})


class AuthController {

    static async checkConn(req, res) {
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
    }

    static async generateJWT(user, options = {}) {
        const payload = {
            id: user.id,
            role: user.role,
        };

        // Access Token (short-lived)
        const accessToken = jwt.sign(payload, accessSecret, {
            expiresIn: accessExpires,
            algorithm: 'HS256',
        });

        // Refresh Token (long-lived)
        const refreshPayload = { id: user.id };

        const refreshToken = jwt.sign(refreshPayload, refreshSecret, {
            expiresIn: refreshExpires,
            algorithm: 'HS256',
        });

        await RefreshToken.findOneAndUpdate(
            { userId: user.id },
            {
                token: refreshToken,
                userAgent: options.userAgent || null,
                ip: options.ip || null,
            },
            { upsert: true, new: true }
        );
        const { AAngBase } = await getModels();

        await AAngBase.updateOne(
            { _id: user.id },
            {

                $push: {
                    sessionTokens: {
                        token: accessToken,
                        createdAt: new Date(),
                    },
                },
            }
        );

        return { accessToken, refreshToken };
    }

    static async socialSignIn(req, res) {
        const { tokenResponse, provider, role } = req.body;

        if (!tokenResponse || !provider || !role) {
            return res.status(401).json({ error: 'Invalid request : Missing requirements' });
        }
        const { idToken } = tokenResponse;
        // capitalize the first letter of the role --- client --> Client, driver --> Driver
        const roleCapitalized = role.charAt(0).toUpperCase() + role.slice(1);

        try {
            await dbClient.connect(); // Ensure DB connection

            const userInfo = await AuthController.verifyGoogleIdToken(idToken);

            const { email, name, picture, googleId } = userInfo;

            const { AAngBase } = await getModels();

            // Check if user already exists
            let user = await AAngBase.findOne({ email });
            if (!user) {
                user = await AAngBase.create({
                    email,
                    fullName: name,
                    avatar: picture,
                    googleId,
                    provider,
                    role: roleCapitalized
                });
            }

            const payload = { id: user._id, role: user.role };

            // generate jwt
            const { accessToken, refreshToken } = await AuthController.generateJWT(payload);
            console.log('New User Created Successfully');

            return res.status(201).json({
                accessToken,
                refreshToken,
                user: {
                    email: user.email,
                    name: user.fullName,
                    avatar: user.avatar,
                    role: user.role.toLowerCase(),
                },
                expiresIn: accessExpiresMs
            });

        } catch (err) {
            console.error(err);
            return res.status(401).json({ error: 'Invalid Google token' });
        }
    }

    static async verifyGoogleIdToken(idToken) {
        const ticket = await client.verifyIdToken({
            idToken,
            audience: process.env.GOOGLE_CLIENT_ID,
        });

        const payload = ticket.getPayload(); // Contains user info
        return {
            email: payload.email,
            name: payload.name,
            picture: payload.picture,
            googleId: payload.sub,
        };
    }

    static async refreshToken(req, res) {
        console.log('[RefreshToken] Request received');
        try {
            const authHeader = req.headers.authorization;
            const { refreshToken } = req.body;

            // 1. Validate inputs
            const oldAccessToken = AuthController.extractAccessToken(authHeader);
            if (!refreshToken) return res.status(400).json({ error: 'Refresh token required in body' });

            // 2. Decode tokens
            const decodedAccess = AuthController.verifyAccessToken(oldAccessToken);
            const decodedRefresh = AuthController.verifyRefreshToken(refreshToken);

            // 3. Match user IDs
            if (decodedAccess.id !== decodedRefresh.id) {
                return res.status(401).json({ error: 'Token mismatch' });
            }

            // 4. Validate refresh token from DB
            const stored = await AuthController.validateRefreshTokenInDB(decodedAccess.id, refreshToken);
            if (!stored) {
                return res.status(403).json({ error: 'Refresh token not found or revoked' });
            }

            // 5. Rotate tokens
            const { accessToken, newRefreshToken } = AuthController.rotateTokens(decodedAccess);

            // 6. Replace in DB
            stored.token = newRefreshToken;
            await stored.save();

            // 7. Send new tokens
            console.log('[RefreshToken] Tokens rotated successfully');
            return res.status(200).json({
                accessToken,
                refreshToken: newRefreshToken,
                expiresIn: accessExpiresMs,
            });

        } catch (err) {
            console.error('[RefreshToken Error]', err.message);
            return res.status(401).json({ error: 'Invalid or expired tokens' });
        }
    }

    static extractAccessToken(authHeader) {
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            throw new Error('Missing or malformed Authorization header');
        }
        return authHeader.split(' ')[1];
    }

    static verifyAccessToken(token) {
        try {
            return jwt.verify(token, accessSecret, { ignoreExpiration: true });
        } catch (err) {
            throw new Error('Invalid access token');
        }
    }

    static verifyRefreshToken(token) {
        try {
            return jwt.verify(token, refreshSecret);
        } catch (err) {
            throw new Error('Invalid refresh token');
        }
    }

    static async validateRefreshTokenInDB(userId, token) {
        const stored = await RefreshToken.findOne({ userId, token });
        if (!stored) return null;

        if (stored.isExpired && stored.isExpired()) {
            await RefreshToken.deleteOne({ _id: stored._id });
            return null;
        }

        return stored;
    }

    static rotateTokens(userPayload) {
        const accessToken = jwt.sign(
            { id: userPayload.id, role: userPayload.role },
            accessSecret,
            { expiresIn: accessExpires, algorithm: 'HS256' }
        );

        const newRefreshToken = jwt.sign(
            { id: userPayload.id },
            refreshSecret,
            { expiresIn: refreshExpires, algorithm: 'HS256' }
        );

        return { accessToken, newRefreshToken };
    }

    static async signUp(req, res) {
        const { email, password, role } = req.body;

        if (!email || !password || !role) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        try {
            await dbClient.connect(); // Ensure DB connection

            const { AAngBase } = await getModels();

            // Check if user already exists
            let user = await AAngBase.findOne({ email });
            if (user) {
                return res.status(409).json({ error: 'User already exists' });
            }
            const roleCapitalized = role.charAt(0).toUpperCase() + role.slice(1);

            // Hash the password before saving the user
            const hashedPassword = await AuthController.hashPassword(password);


            user = await AAngBase.create({
                email,
                password: hashedPassword,
                role: roleCapitalized,
            });

            const payload = { id: user._id, role: user.role };

            // generate jwt
            const { accessToken, refreshToken } = await AuthController.generateJWT(payload);

            return res.status(201).json({
                accessToken,
                refreshToken,
                user: {
                    email: user.email,
                    role: user.role.toLowerCase(),
                },
                expiresIn: accessExpiresMs
            });

        } catch (err) {
            console.error(err);
            return res.status(500).json({ error: 'Internal server error' });
        }
    }

    static async login(req, res) {
        const { email, password, role } = req.body;

        if (!email || !password || !role) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        try {
            await dbClient.connect();

            const { AAngBase } = await getModels();

            // Check if user already exists
            let user = await AAngBase.findOne({ email });
            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }

            // Check if the role matches
            if (user.role.toLowerCase() !== role.toLowerCase()) {
                return res.status(403).json({ error: 'Unauthorized role access' });
            }

            // Check if the password is correct
            const isPasswordValid = await AuthController.comparePassword(password, user.password);
            if (!isPasswordValid) {
                return res.status(401).json({ error: 'Invalid credentials' });
            }

            const payload = { id: user._id, role: user.role };

            // generate jwt
            const { accessToken, refreshToken } = await AuthController.generateJWT(payload);

            return res.status(201).json({
                accessToken,
                refreshToken,
                user: {
                    email: user.email,
                    role: user.role.toLowerCase(),
                },
                expiresIn: accessExpiresMs
            });
        } catch (err) {
            console.error(err);
            return res.status(500).json({ error: 'Internal server error' });
        }
    }

    static async hashPassword(password) {
        try {
            const salt = await bcrypt.genSalt(10);
            return await bcrypt.hash(password, salt);
        } catch (error) {
            console.error("Error hashing password:", error.message);
            throw new Error("Password hashing failed");
        }
    }

    static async comparePassword(plainPassword, hashedPassword) {
        try {
            return await bcrypt.compare(plainPassword, hashedPassword);
        } catch (error) {
            console.error("Error comparing passwords:", error.message);
            throw new Error("Password comparison failed");
        }
    }

}

module.exports = AuthController;
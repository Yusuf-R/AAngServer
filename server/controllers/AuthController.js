import dbClient from "../database/mongoDB";
import ms from 'ms';
import jwt from "jsonwebtoken";
const redisClient = require('../utils/redis');
const {OAuth2Client} = require('google-auth-library');
import getModels from "../models/AAng/AAngLogistics";
import RefreshToken from "../models/RefreshToken";


const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const accessSecret = process.env.JWT_ACCESS_SECRET;
const refreshSecret = process.env.JWT_REFRESH_SECRET;
const accessExpires = process.env.JWT_ACCESS_EXPIRES_IN;
const refreshExpires = process.env.JWT_REFRESH_EXPIRES_IN;
const accessExpiresMs = ms(accessExpires);

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


}

module.exports = AuthController;
// utils/WebhookAuth.js
import jwt from 'jsonwebtoken';

class WebhookAuth {
    static generateToken(payload = {}) {
        return jwt.sign(
            {
                ...payload,
                iss: 'nextjs-admin',
                iat: Math.floor(Date.now() / 1000)
            },
            process.env.WEBHOOK_SECRET,
            { expiresIn: '5m' } // Short-lived token
        );
    }

    static verifyToken(token) {
        try {
            return jwt.verify(token, process.env.WEBHOOK_SECRET, {
                issuer: 'nextjs-admin',
                maxAge: '5m'
            });
        } catch (error) {
            throw new Error(`Token verification failed: ${error.message}`);
        }
    }

    static middleware(req, res, next) {
        const authHeader = req.headers.authorization;
        console.log({
            authHeader
        })

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Missing authorization token' });
        }

        const token = authHeader.substring(7); // Remove "Bearer "
        console.log({
            token
        })

        try {
            req.webhookAuth = WebhookAuth.verifyToken(token);
            next();
        } catch (error) {
            console.log({
                error
            })
            return res.status(401).json({ error: 'Invalid token' });
        }
    }
}

export default WebhookAuth;
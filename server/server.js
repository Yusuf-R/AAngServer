import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import SecurityConfig from './utils/config';
import http from 'http';
import { Server } from 'socket.io';
import AuthController from "./controllers/AuthController";
import os from 'os';
import redisClient from './utils/redis';
import dbClient from '../server/database/mongoDB';
import NotificationSocket from "./socket/NotificationSocket";
import DriverNotificationService from "./services/DriverNotificationService";
import ChatController from "./controllers/ChatController";

const app = express();
const securityConfig = new SecurityConfig();
const { corsOptions } = securityConfig;

dotenv.config({ path: '.env' });

// 📦 Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.options('*', cors(corsOptions));
app.use(cors(corsOptions));

// Create HTTP server
const server = http.createServer(app);

// Initialize Socket.IO
const io = new Server(server, {
    cors: {
        origin: [
            'http://localhost:3000',  // Next.js dev server
            'http://127.0.0.1:3000',  // Alternative localhost
            '*'
        ].filter(Boolean),
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
        credentials: true
    },
    allowEIO3: true
});

// Make io available globally
global.io = io;

// Initialize router with io instance
const createRouter = require('./routes/router');
const router = createRouter(io);

// 📌 REST API routes
app.use('/api/v1/order/paystack-webhook', express.raw({
    type: 'application/json'
}));
app.use(router);

const port = process.env.EXPRESS_PORT;

// ✅ Make io globally available
global.io = io;

// 🔐 Middleware for socket authentication
io.use(async (socket, next) => {
    const { token, clientType } = socket.handshake.auth || {};

    if (!token) {
        socket.userId = null;
        socket.isAnonymous = true;
        return next();
    }

    try {
        let user;

        if (clientType === 'web') {
            // Web: use SOCKET_SECRET
            user = await AuthController.verifyNextAuthSession(token);
        } else {
            // Assume mobile (or legacy): use JWT_ACCESS_SECRET
            user = await AuthController.verifySocketAccessToken(token);
        }

        if (!user?._id) {
            return next(new Error('User not found or unauthorized'));
        }

        socket.userId = user._id.toString();
        socket.isAnonymous = false;
        socket.clientType = clientType || 'mobile';
        socket.userRole = user.role;
        socket.isAdmin = user.role === 'Admin';
        socket.adminRole = user?.adminRole || null;
        next();
    } catch (err) {
        console.error('Socket auth failed:', err.message);
        return next(new Error('Authentication failed'));
    }
});

// 🧠 Socket logic
io.on('connection', (socket) => {
    if (socket.isAnonymous) {
        console.log('🔍 Anonymous socket connected for diagnostics');

        socket.on('ping:health', (clientTime, callback) => {
            const serverTime = Date.now();
            const latency = serverTime - clientTime;
            callback({ serverTime, latency });
        });

        return; // exit early for anonymous clients
    }

    // Admin testing events
    socket.on('admin:test-notification', (data) => {
        console.log('Admin test notification:', data);
        // Echo back to admin or broadcast to relevant users
        socket.emit('notification:new', {
            ...data,
            from: 'system',
            type: 'test'
        });
    });

    socket.on('admin:broadcast', (data) => {
        if (!socket.isAdmin && socket.userRole !== 'Admin') {
            return socket.emit('error', { message: 'Unauthorized' });
        }

        console.log('Admin broadcasting:', data);

        // Broadcast to all connected sockets except sender
        socket.broadcast.emit('broadcast:message', {
            ...data,
            from: socket.userId,
            sentAt: new Date()
        });

        // Confirm to sender
        socket.emit('broadcast:confirmed', {
            recipients: io.sockets.sockets.size - 1,
            ...data
        });
    });

    // In your Node.js WebSocket server
    socket.on('order:assignment', async (data) => {
        try {
            console.log('📦 Received order assignment from admin: ',   data.orderAssignment._id);

            // Acknowledge receipt back to admin
            socket.emit('order:assignment:ack', {
                success: true,
                timestamp: new Date().toISOString()
            });
            // implement notification logic here
            // >> in app notification and push notification
            const {orderAssignment, orderId } = data;
            const results = await DriverNotificationService.handleOrderAssignment(orderAssignment);

            socket.emit('order:assignment:ack', {
                success: true,
                orderAssignmentId: orderAssignment._id,
                notificationResults: results,
                timestamp: new Date().toISOString()
            });

            console.log(`✅ Notifications processed for order ${orderAssignment._id}`);
        } catch (error) {
            console.error('Error processing order assignment:', error);
            socket.emit('order:assignment:error', {
                error: error.message,
            });
        }
    });

    // 👤 Authenticated user socket
    console.log(`✅ Authenticated socket connected: ${socket.userId}`);
    socket.join(`user:${socket.userId}`);

    // ✅ Delegate to NotificationSocket class
    new NotificationSocket(socket);

    // Optional: Keep generic handlers here
    socket.on('ping:health', (clientTime, callback) => {
        const serverTime = Date.now();
        const latency = serverTime - clientTime;
        callback({ serverTime, latency });
    });

    socket.on('chat:join-conversation', async (conversationId) => {
        socket.join(conversationId);
        console.log(`📨 User ${socket.userId} joined conversation room: ${conversationId}`);
    });

    socket.on('chat:leave-conversation', (conversationId) => {
        socket.leave(conversationId);
        console.log(`🚪 User ${socket.userId} left conversation: ${conversationId}`);
    });

    // Chat sections
    socket.on('chat:send-message', async (data) => {
        try {
            const { conversationId, body, kind = 'text', source = 'mobile', message } = data;

            console.log(`📤 ${source.toUpperCase()} message from ${socket.userId || 'web-admin'}`);

            let savedMessage;

            if (source === 'mobile') {
                // MOBILE: Save to DB + deliver
                const messageResult = await ChatController.sendMessage({
                    conversationId,
                    userId: socket.userId,
                    userRole: socket.userRole,
                    messageData: { body, kind }
                });

                if (!messageResult.success) {
                    return socket.emit('chat:error', { error: messageResult.error });
                }
                savedMessage = messageResult.data;
            } else {
                // ADMIN: Use provided message (already saved by Next.js)
                savedMessage = message;
            }

            // Find the OTHER person in this 1-1 chat
            const getConversationModel = await import('./models/Conversation').then(m => m.default);
            const Conversation = await getConversationModel();
            const conversation = await Conversation.findById(conversationId);
            const otherParticipant = conversation.participants.find(
                p => p.userId.toString() !== (source === 'web' ? savedMessage.senderId : socket.userId)
            );

            if (!otherParticipant) {
                return socket.emit('chat:error', { error: 'Other participant not found' });
            }

            socket.to(conversationId).emit('chat:message:new', savedMessage);

            // Deliver to the other person
            socket.to(`user:${otherParticipant.userId}`).emit('chat:message:new', savedMessage);

            // Confirm to sender (if it came via socket)
            if (source !== 'web') { // Only confirm for mobile, admin already knows
                socket.emit('chat:message:sent', savedMessage);
            }

            console.log(`✅ Delivered to: ${otherParticipant.userId} via ${source === 'web' ? 'socket-primary' : 'socket-mobile'}`);
            console.log(`✅ Delivered to conversation room: ${conversationId}`);
            console.log(`✅ Delivered to user room: user:${otherParticipant.userId}`);

        } catch (error) {
            console.error('❌ Delivery error:', error);
            socket.emit('chat:error', { error: 'Failed to deliver message' });
        }
    });

    socket.on('disconnect', () => {
        console.log(`❌ Socket disconnected: ${socket.userId}`);
    });
});

// 🔍 Utility to get local IP for FE socket URL
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return 'localhost';
}

const localIP = getLocalIP();

// 🚀 Start the server
(async function startServer() {
    try {
        const redisStatus = await redisClient.isAlive();
        if (!redisStatus) {
            console.error('❌ Failed to initialize Redis');
            process.exit(1);
        }

        await dbClient.connect();
        if (await dbClient.isAlive()) {
            console.log('✅ Database connection established');
        } else {
            console.error('❌ Database connection failed');
            process.exit(1);
        }

        // Load ALL models
        const getModels = await import('./models/AAng/AAngLogistics.js').then(m => m.default);
        const getOrderModels = await import('./models/Order').then(m => m.default);
        const getConversationModel = await import('./models/Conversation').then(m => m.default);
        const getMessageModel = await import('./models/Message').then(m => m.default);

        // Initialize all models
        await getOrderModels();
        await getModels();
        await getConversationModel(); // ✅ Chat models registered
        await getMessageModel();      // ✅ Chat models registered

        server.listen(port, () => {
            console.log('✅ All database models registered');
            console.log(`🌐 Express server listening at http://localhost:${port}`);
            console.log(`✅ Socket.IO ready at http://${localIP}:${port}`);
        });

    } catch (error) {
        console.error({
            info: '🚨 Server failed to start',
            error,
            details: error.message,
        });
        process.exit(1);
    }
}());

// Export server instance (e.g. for testing)
module.exports = server;

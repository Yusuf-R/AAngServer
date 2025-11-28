import SecurityConfig from "../utils/config";

const express = require('express');
const cors = require('cors');

const authRouter = require('./AuthRoutes');
const userRouter = require('./UserRoutes');
const notificationRouter = require('./NotificationRoutes');
const s3Router = require('./S3Routes');
const orderRouter = require('./OrderRoutes');
const driverRouter = require('./DriverRoutes');
const webhookRouter = require('./WebHookRoutes');
import initWebAdminRoutes from './WebAdminRoutes';

const securityConfig = new SecurityConfig();
const { corsOptions } = securityConfig;

const createRouter = (io) => {
    const router = express.Router();
    
    // Initialize webAdminRouter with io instance
    const webAdminRouter = initWebAdminRoutes(io);
    
    // middleware
    router.use(cors(corsOptions));
    router.options('*', cors(corsOptions));
    
    // API routes
    router.use('/api/v1/auth', authRouter);
    router.use('/api/v1/user', userRouter);
    router.use('/api/v1/notification', notificationRouter);
    router.use('/api/v1/s3', s3Router);
    router.use('/api/v1/order', orderRouter);
    router.use('/api/v1/driver', driverRouter);
    router.use('/api/v1/webadmin', webAdminRouter);
    router.use('/api/v1/webhook', webhookRouter);

    
    return router;
};

module.exports = createRouter;
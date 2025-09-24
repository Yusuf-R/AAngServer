import SecurityConfig from "../utils/config";

const express = require('express');
const cors = require('cors');

const authRouter = require('./AuthRoutes');
const userRouter = require('./UserRoutes');
const notificationRouter = require('./NotificationRoutes');
const s3Router = require('./S3Routes');
const orderRouter = require('./OrderRoutes');
const adminRouter = require('./AdminRoutes');

const securityConfig = new SecurityConfig()
const { corsOptions } = securityConfig;



const router = express.Router();
// middleware
router.use(cors(corsOptions));
router.options('*', cors(corsOptions));

// //  All routes
router.use('/api/v1/auth', authRouter);
router.use('/api/v1/user', userRouter);
router.use('/api/v1/notification', notificationRouter);
router.use('/api/v1/s3', s3Router);
router.use('/api/v1/order', orderRouter);
router.use('/api/v1/admin', adminRouter);

module.exports = router;
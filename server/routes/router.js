import SecurityConfig from "../utils/config";

const express = require('express');
const cors = require('cors');

const authRouter = require('./AuthRoutes');
const userRouter = require('./UserRoutes');
const notificationRouter = require('./NotificationRoutes');

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

module.exports = router;
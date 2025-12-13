/* eslint-disable import/no-unresolved */
/* eslint-disable jest/require-hook */
import SecurityConfig from "../utils/config";

const express = require('express');
const cors = require('cors');
const userController = require('../controllers/UserController');

const securityConfig = new SecurityConfig();
const {corsOptions} = securityConfig;

const userRouter = express.Router();

userRouter.use(cors(corsOptions));
userRouter.options('*', cors(corsOptions));

userRouter.put('/update-profile', userController.updateProfile);
userRouter.put('/update-avatar', userController.updateAvatar);
userRouter.post('/location/create', userController.createLocation);
userRouter.put('/location/update', userController.updateLocation);
userRouter.delete('/location/delete', userController.deleteLocation);
userRouter.get('/financial-data', userController.getFinancialData);
userRouter.get('/transactions', userController.getTransactionHistory);
userRouter.get('/finance/summary', userController.getFinancialSummary);
userRouter.get('/finance/transactions', userController.getFinancialTransactions);
userRouter.get('/finance/topup/history', userController.getTopUpHistory);
userRouter.post('/wallet/topup/initiate', userController.initiateTopUp);
// userRouter.post('/wallet/topup/verify', userController.verifyTopUp);
userRouter.get('/wallet/balance', userController.getWalletBalance);
userRouter.post('/wallet/topup/generate-reference', userController.generateTopUpReference);
userRouter.post('/wallet/topup/verify', userController.verifyTopUpPayment);
userRouter.post('/wallet/topup/check-pending', userController.checkPendingTopUp);
// analytics

// Routes
// Add to your client routes file
userRouter.get('/analytics', userController.clientAnalytics);
userRouter.get('/delivery/analytics', userController.clientOrderAnalytics);
userRouter.get('/delivery/:orderId', userController.getSingleOrder);
userRouter.get('/payment/analytics', userController.clientPaymentAnalytics);
userRouter.get('/payment/:txId', userController.clientSinglePayment);

// /routes/clientAnalyticsRoutes.js - Add this route
userRouter.post('/analytics/migrate', userController.migrateClientAnalytics);


module.exports = userRouter;
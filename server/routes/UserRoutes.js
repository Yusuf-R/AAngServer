/* eslint-disable import/no-unresolved */
/* eslint-disable jest/require-hook */
import SecurityConfig from "../utils/config";

const express = require('express');
const cors = require('cors');
const userController = require('../controllers/UserController');
const chatController = require('../controllers/ChatController');
const ticketController = require('../controllers/TicketController');

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

//Finance
userRouter.get('/financial-data', userController.getFinancialData);
userRouter.get('/transactions', userController.getTransactionHistory);
userRouter.get('/finance/summary', userController.getFinancialSummary);
userRouter.get('/finance/transactions', userController.getFinancialTransactions);
userRouter.get('/finance/topup/history', userController.getTopUpHistory);
userRouter.post('/wallet/topup/initiate', userController.initiateTopUp);

// Wallet
userRouter.get('/wallet/balance', userController.getWalletBalance);
userRouter.post('/wallet/topup/generate-reference', userController.generateTopUpReference);
userRouter.post('/wallet/topup/verify', userController.verifyTopUpPayment);
userRouter.post('/wallet/topup/check-pending', userController.checkPendingTopUp);

// analytics
userRouter.get('/analytics', userController.clientAnalytics);
userRouter.get('/delivery/analytics', userController.clientOrderAnalytics);
userRouter.get('/delivery/:orderId', userController.getSingleOrder);
userRouter.get('/payment/analytics', userController.clientPaymentAnalytics);
userRouter.get('/payment/:txId', userController.clientSinglePayment);
userRouter.post('/analytics/migrate', userController.migrateClientAnalytics);

// chat
userRouter.post('/support/chat/message/send', chatController.sendMessage);
userRouter.post('/support/chat/get-or-create', chatController.getOrCreateClientSupportConversation);
userRouter.get('/support/chat/messages/:conversationId', chatController.getConversationMessages);

// ticket
userRouter.post('/support/ticket/create', ticketController.createTicket);
userRouter.get('/support/ticket/all', ticketController.getAllUserTicket);
userRouter.get('/support/ticket/get', ticketController.getTicketById);
userRouter.delete('/support/ticket/delete', ticketController.deleteTicket);


module.exports = userRouter;
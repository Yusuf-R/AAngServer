/* eslint-disable import/no-unresolved */
/* eslint-disable jest/require-hook */
import SecurityConfig from "../utils/config";

const express = require('express');
const cors = require('cors');
const driverController = require('../controllers/DriverController');
const chatController = require('../controllers/ChatController');
const ticketController = require('../controllers/TicketController');

const securityConfig = new SecurityConfig();
const { corsOptions } = securityConfig;

const driverRouter = express.Router();

driverRouter.use(cors(corsOptions));
driverRouter.options('*', cors(corsOptions));

driverRouter.patch('/availability', driverController.updateOnlineStatus);
driverRouter.put('/update-profile', driverController.updateProfile);
driverRouter.put('/update-avatar', driverController.updateAvatar);
driverRouter.post('/location/create', driverController.createLocation);
driverRouter.put('/location/update', driverController.updateLocation);
driverRouter.delete('/location/delete', driverController.deleteLocation);
driverRouter.patch('/tcs', driverController.tcsAcceptance);

// verification
// email
driverRouter.post('/auth/get/token', driverController.getToken);
driverRouter.post('/auth/verify/auth-token', driverController.verifyAuthPinToken);
driverRouter.post('/auth/set/auth-pin', driverController.setAuthPin);
driverRouter.post('/auth/verify/email', driverController.verifyEmail);

// // password
driverRouter.post('/auth/password/reset', driverController.resetPassword);
// driverRouter.post('/auth/password/reset-password', driverController.emailResetPassword);

// data validation
driverRouter.get('/verification/status', driverController.verificationStatus);
driverRouter.patch('/verification/submit', driverController.submitVerification);
// chat
driverRouter.post('/support/chat/message/send', chatController.sendMessage);
driverRouter.post('/support/chat/get-or-create', chatController.getOrCreateDriverSupportConversation);

// ticket
driverRouter.post('/support/ticket/create', ticketController.createTicket);
driverRouter.get('/support/ticket/all', ticketController.getAllUserTicket);
driverRouter.get('/support/ticket/get', ticketController.getTicketById);
driverRouter.delete('/support/ticket/delete', ticketController.deleteTicket);

// notification
driverRouter.get('/notification/all', driverController.getDriverNotification);
driverRouter.get('/notification/stats', driverController.getNotificationStats);
driverRouter.delete('/notification/delete', driverController.deleteNotification);
driverRouter.delete('/notification/delete/all', driverController.deleteAllNotifications);
driverRouter.patch('/notification/mark-as-read', driverController.markAsRead);
driverRouter.patch('/notification/mark-all-as-read', driverController.markAllAsRead);

// orders
driverRouter.get('/orders/get/available', driverController.getAvailableOrders);
driverRouter.patch('/order/accept', driverController.acceptOrder);
driverRouter.patch('/order/location/update', driverController.updateActiveDeliveryLocation);
driverRouter.patch('/order/arrived-pickup', driverController.arrivedPickUp)
driverRouter.patch('/order/confirm-pickup', driverController.confirmPickUp)
driverRouter.patch('/order/arrived-dropoff', driverController.arrivedDropOff)
driverRouter.patch('/order/verify/delivery-token', driverController.verifyDeliveryToken)
driverRouter.patch('/order/complete-delivery', driverController.completeDelivery)
driverRouter.patch('/order/submit/review', driverController.reviewDelivery)

// get dashboard data
driverRouter.get('/dashboard/data', driverController.driverData)
driverRouter.get('/analytics', driverController.driverAnalytics)
driverRouter.get('/earning/analytics', driverController.driverEarningsAnalytics)
driverRouter.get('/earning/:transactionId', driverController.getSingleTransaction)
driverRouter.get('/delivery/analytics', driverController.driverDeliveryAnalytics)
driverRouter.get('/delivery/:orderId', driverController.getSingleDelivery)
driverRouter.post('/analytics/migrate', driverController.migrateAnalytics)
driverRouter.post('/retroactive/financials', driverController.updateOrderRecords)
driverRouter.post('/update/earnings', driverController.updateDriverEarnings)

// finance
driverRouter.get('/finance/summary', driverController.getFinancialSummary)
driverRouter.get('/finance/earning/history', driverController.getEarningHistory)
driverRouter.get('/finance/payout/history', driverController.getPayoutHistory)
driverRouter.post('/finance/bank/new', driverController.newBankAccount)
driverRouter.patch('/finance/bank/update', driverController.updateBank)
driverRouter.delete('/finance/bank/delete', driverController.deleteBankAccount)
driverRouter.post('/finance/request/payout', driverController.requestPayout)
driverRouter.get('/finance/verify/payout', driverController.verifyPayout)
driverRouter.post('/finance/verify/pin', driverController.verifyWithdrawalPin)





module.exports = driverRouter;
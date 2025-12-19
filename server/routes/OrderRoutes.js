/* eslint-disable import/no-unresolved */
/* eslint-disable jest/require-hook */
import SecurityConfig from "../utils/config";

const express = require('express');
const cors = require('cors');
const orderController = require('../controllers/OrderController');

const securityConfig = new SecurityConfig();
const { corsOptions } = securityConfig;

const orderRouter = express.Router();

orderRouter.use(cors(corsOptions));
orderRouter.options('*', cors(corsOptions));

// Order Routes
orderRouter.post('/instantiate', orderController.instantObject);
orderRouter.post('/create', orderController.createOrder);
orderRouter.get('/all', orderController.getAllClientOrders);
orderRouter.get('/draft/resume', orderController.resumeDraft);
orderRouter.get('/history', orderController.getOrderHistory);
orderRouter.get('/history/search', orderController.searchOrderHistory);
orderRouter.delete('/delete', orderController.deleteOrder);
orderRouter.patch('/save', orderController.saveDraft);
orderRouter.patch('/submit', orderController.submitOrder);
orderRouter.post('/init-pay', orderController.initiatePayment);
orderRouter.get('/payment-callback', orderController.paystackPaymentCallback); // after payment[MUST], the browser triggers base on the callback_url as provided
orderRouter.get('/payment-status', orderController.checkPaymentStatus); // To check payment status by the FE once browser has returned to the app
orderRouter.post('/paystack-webhook', orderController.paystackWebhook); // payStack uses this to talk to BE base on whatever action the user did on the browser
orderRouter.post('/payment/wallet-only', orderController.processWalletPayment);
orderRouter.post('/payment/hybrid', orderController.processHybridPayment);

module.exports = orderRouter;
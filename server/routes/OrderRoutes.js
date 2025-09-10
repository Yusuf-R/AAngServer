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
orderRouter.delete('/delete', orderController.deleteOrder);
orderRouter.patch('/save', orderController.saveDraft);
orderRouter.patch('/submit', orderController.submitOrder);
orderRouter.post('/init-pay', orderController.initiatePayment);
orderRouter.get('/payment-callback', orderController.paystackPaymentCallback); // after payment[MUST], the browser triggers base on the callback_url as provided
orderRouter.get('/payment-status', orderController.checkPaymentStatus); // To check payment status by the FE
orderRouter.post('/paystack-webhook', orderController.paystackWebhook);

module.exports = orderRouter;
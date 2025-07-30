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

module.exports = orderRouter;
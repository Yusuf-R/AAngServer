/* eslint-disable import/no-unresolved */
/* eslint-disable jest/require-hook */
import SecurityConfig from "../utils/config";

const express = require('express');
const cors = require('cors');
const webHookController = require('../controllers/WebhookController');

const securityConfig = new SecurityConfig();
const { corsOptions } = securityConfig;

const webHookRouter = express.Router();

webHookRouter.use(cors(corsOptions));
webHookRouter.options('*', cors(corsOptions));


webHookRouter.post('/paystack-webhook', webHookController.handlePaystackWebhook);
// webHookRouter.post('/paystack-webhook', webHookController.test);


module.exports = webHookRouter;
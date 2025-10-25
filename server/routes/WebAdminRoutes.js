/* eslint-disable import/no-unresolved */
/* eslint-disable jest/require-hook */
import SecurityConfig from "../utils/config";
import WebhookAuth from "../utils/WebhookAuth";
import WebAdminController, { setIO } from "../controllers/WebAdminController";

const express = require('express');
const cors = require('cors');

const securityConfig = new SecurityConfig();
const { corsOptions } = securityConfig;

const initWebAdminRoutes = (io) => {
    // Set the io instance in WebAdminController
    setIO(io);
    
    const webAdminRouter = express.Router();
    
    webAdminRouter.use(cors(corsOptions));
    webAdminRouter.options('*', cors(corsOptions));
    
    webAdminRouter.post('/deliver-message', WebhookAuth.middleware, WebAdminController.deliverMessage);
    webAdminRouter.get('/health', WebhookAuth.middleware, WebAdminController.healthCheck);
    
    return webAdminRouter;
};

export default initWebAdminRoutes;
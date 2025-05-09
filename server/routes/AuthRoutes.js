/* eslint-disable no-unused-vars */
/* eslint-disable jest/require-hook */
import SecurityConfig from "../utils/config";

const express = require('express');
const cors = require('cors');
const authController = require('../controllers/AuthController');

const securityConfig = new SecurityConfig();
const { corsOptions } = securityConfig;

const authRouter = express.Router();

authRouter.use(cors(corsOptions));
authRouter.options('*', cors(corsOptions));


authRouter.get('/test', authController.checkConn);
authRouter.post('/oauth', authController.socialSignIn)

module.exports = authRouter;
import SecurityConfig from "../utils/config";
import AuthController from '../controllers/AuthController'; // Use ES module import

const express = require('express');
const cors = require('cors');

const securityConfig = new SecurityConfig();
const { corsOptions } = securityConfig;

const authRouter = express.Router();

authRouter.use(cors(corsOptions));
authRouter.options('*', cors(corsOptions));

authRouter.get('/test', AuthController.checkConn);
authRouter.post('/oauth', AuthController.socialSignIn);
authRouter.post('/refresh', AuthController.refreshToken);
authRouter.post('/signup', AuthController.signUp);
authRouter.post('/login', AuthController.logIn);

module.exports = authRouter;
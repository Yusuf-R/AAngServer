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
authRouter.post('/get-token', AuthController.getToken);
authRouter.post('/verify-email', AuthController.verifyEmail);
authRouter.post('/forgot-password-token', AuthController.forgotPasswordToken);
authRouter.post('/reset-password', AuthController.resetPassword);
authRouter.post('/update-password', AuthController.updatePassword);
authRouter.post('/set-pin', AuthController.setAuthPin);
authRouter.put('/update-pin', AuthController.updateAuthPin);
authRouter.post('/reset-pin', AuthController.resetAuthPin);
authRouter.post('/pin-token', AuthController.requestAuthPinToken);
authRouter.post('/verify-pin', AuthController.verifyAuthPin);
authRouter.patch('/toggle-pin', AuthController.toggleAuthPin);
authRouter.delete('/remove-pin', AuthController.removeAuthPin);
authRouter.get('/status-pim', AuthController.getAuthPinStatus);

module.exports = authRouter;
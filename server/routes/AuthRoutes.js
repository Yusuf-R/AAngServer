import SecurityConfig from "../utils/config";
import AuthController from '../controllers/AuthController'; // Use ES module import

const express = require('express');
const cors = require('cors');

const securityConfig = new SecurityConfig();
const { corsOptions } = securityConfig;

const authRouter = express.Router();

authRouter.use(cors(corsOptions));
authRouter.options('*', cors(corsOptions));

// Connection Test
authRouter.get('/test', AuthController.checkConn);

// Authentication Routes
authRouter.post('/oauth', AuthController.socialSignIn);
authRouter.post('/refresh', AuthController.refreshToken);
authRouter.post('/signup', AuthController.signUp);
authRouter.post('/login', AuthController.logIn);
authRouter.post('/get-token', AuthController.getToken);

// User Management
authRouter.post('/verify-email', AuthController.verifyEmail);
authRouter.post('/request-password-reset', AuthController.forgotPasswordToken);
authRouter.post('/reset-password', AuthController.resetPassword);
authRouter.post('/update-password', AuthController.updatePassword);

// Auth PIn
authRouter.post('/set-pin', AuthController.setAuthPin);
authRouter.put('/update-pin', AuthController.updateAuthPin);
authRouter.post('/reset-pin', AuthController.resetAuthPin);
authRouter.post('/pin-token', AuthController.requestAuthPinToken);
authRouter.post('/verify-pin', AuthController.verifyAuthPin);
authRouter.patch('/toggle-pin', AuthController.toggleAuthPin);
authRouter.delete('/remove-pin', AuthController.removeAuthPin);
authRouter.get('/status-pim', AuthController.getAuthPinStatus);
authRouter.patch('/update-push-token', AuthController.updatePushToken);

// Terms and Conditions
authRouter.post('/tcs', AuthController.acceptTCs);

// Dashboard Data
authRouter.get('/dashboard', AuthController.getDashboardData);

// Cloudinary Image Upload
authRouter.get('/get-signed-url', AuthController.getSignedUrl);

module.exports = authRouter;
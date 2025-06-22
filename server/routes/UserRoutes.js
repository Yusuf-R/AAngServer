/* eslint-disable import/no-unresolved */
/* eslint-disable jest/require-hook */
import SecurityConfig from "../utils/config";

const express = require('express');
const cors = require('cors');
const userController = require('../controllers/UserController');

const securityConfig = new SecurityConfig();
const { corsOptions } = securityConfig;

const userRouter = express.Router();

userRouter.use(cors(corsOptions));
userRouter.options('*', cors(corsOptions));

userRouter.put('/update-profile', userController.updateProfile);
userRouter.put('/update-avatar', userController.updateAvatar);

module.exports = userRouter;
import SecurityConfig from "../utils/config";
import AuthController from '../controllers/AdminController'; // Use ES module import

const express = require('express');
const cors = require('cors');

const securityConfig = new SecurityConfig();
const { corsOptions } = securityConfig;

const adminRouter = express.Router();



module.exports = adminRouter;
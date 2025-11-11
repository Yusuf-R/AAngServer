/* eslint-disable import/no-unresolved */
/* eslint-disable jest/require-hook */
import SecurityConfig from "../utils/config";

const express = require('express');
const cors = require('cors');
const s3Controller = require('../controllers/S3Controller');

const securityConfig = new SecurityConfig();
const { corsOptions } = securityConfig;

const s3Router = express.Router();

s3Router.use(cors(corsOptions));
s3Router.options('*', cors(corsOptions));

// S3 Routes
s3Router.post('/presigned-url', s3Controller.GeneratePresignedUrl);
s3Router.post('/driver/presigned-url', s3Controller.GenerateDriverPresignedUrl);
s3Router.post('/driver/confirmation-presigned-url', s3Controller.GenerateDriverConfirmationPresignedUrl);
s3Router.get('/driver/order-media', s3Controller.ListOrderMedia);
s3Router.delete('/delete', s3Controller.DeleteFile);

module.exports = s3Router;
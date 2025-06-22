/* eslint-disable import/no-unresolved */
/* eslint-disable jest/require-hook */
import SecurityConfig from "../utils/config";
import NotificationController from '../controllers/NotificationController'; // Use ES module import

const express = require('express');
const cors = require('cors');

const securityConfig = new SecurityConfig();
const { corsOptions } = securityConfig;

const notificationRouter = express.Router();

notificationRouter.use(cors(corsOptions));
notificationRouter.options('*', cors(corsOptions));

notificationRouter.get('/get', NotificationController.getNotifications);
notificationRouter.post('/mark-as-read', NotificationController.markAsRead);
notificationRouter.post('/mark-all', NotificationController.markAllAsRead);
notificationRouter.get('/unread-count', NotificationController.getUnreadCount);
notificationRouter.post('/delete', NotificationController.deleteNotification);
notificationRouter.post('/delete-all', NotificationController.deleteAllNotifications);



module.exports = notificationRouter;
import AuthController from "./AuthController";
import NotificationService from "../services/NotificationService";
import Notification from '../models/Notification';

class NotificationController {

    static async getNotifications(req, res) {
        // Perform API pre-check
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {userData} = preCheckResult;

        try {
            const userId = userData._id;

            const notifications = await NotificationService.getUserNotifications(userId, {
                limit: 20,
                offset: 0
            });

            const stats = await NotificationService.getNotificationStats(userId);

            return res.status(200).json({ notifications, stats });
        } catch (err) {
            console.error('Fetch notifications error:', err);
            return res.status(500).json({ error: 'Failed to fetch notifications' });
        }
    }

    static async getDriverNotification(req, res) {
        // Perform API pre-check
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {userData} = preCheckResult;

        try {
            const userId = userData._id;

            const notifications = await NotificationService.getUserNotifications(userId, {
                limit: 200,
                offset: 0
            });

            const stats = await NotificationService.getNotificationStats(userId);

            return res.status(200).json({ notifications, stats });
        } catch (err) {
            console.error('Fetch notifications error:', err);
            return res.status(500).json({ error: 'Failed to fetch notifications' });
        }
    }

    static async getNotificationStats(req, res) {
        // Perform API pre-check
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {userData} = preCheckResult;

        try {
            const userId = userData._id;

            const stats = await NotificationService.getNotificationStats(userId);

            return res.status(200).json({ stats });
        } catch (err) {
            console.error('Fetch notification stats error:', err);
            return res.status(500).json({ error: 'Failed to fetch notification stats' });
        }
    }


    static async markAsRead(req, res) {
        // Perform API pre-check
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {userData} = preCheckResult;
        try {
            const { id } = req.body;
            if (!id) return res.status(400).json({ error: 'Notification ID is required' });

            const notification = await Notification.findById(id);
            if (!notification) return res.status(404).json({ error: 'Notification not found' });

            await notification.markAsRead();
            return res.status(200).json({ message: 'Notification marked as read' });
        } catch (err) {
            console.error('Mark as read error:', err);
            return res.status(500).json({ error: 'Failed to mark notification as read' });
        }

    }

    static async markAllAsRead(req, res) {
        // Perform API pre-check
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {userData} = preCheckResult;
        try {
            const userId = userData._id;

            const result = await NotificationService.markAllAsRead(userId);
            if (!result) return res.status(404).json({ error: 'No unread notifications found' });

            return res.status(200).json({ message: 'All notifications marked as read' });
        } catch (err) {
            console.error('Mark all as read error:', err);
            return res.status(500).json({ error: 'Failed to mark all notifications as read' });
        }
    }

    static async getUnreadCount(req, res) {
        // Perform API pre-check
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {userData} = preCheckResult;
        try {
            const userId = userData._id;

            const unreadCount = await NotificationService.getUnreadCount(userId);
            return res.status(200).json({ unreadCount });
        } catch (err) {
            console.error('Get unread count error:', err);
            return res.status(500).json({ error: 'Failed to get unread count' });
        }
    }

    static async deleteNotification(req, res) {
        // Perform API pre-check
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {userData} = preCheckResult;
        try {
            const { id } = userData._id;
            const notification = await Notification.findById(id);
            if (!notification) return res.status(404).json({ error: 'Notification not found' });

            await notification.softDelete();
            return res.status(200).json({ message: 'Notification deleted' });
        } catch (err) {
            console.error('Delete notification error:', err);
            return res.status(500).json({ error: 'Failed to delete notification' });
        }
    }

    static async deleteAllNotifications (req, res) {
        // Perform API pre-check
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {userData} = preCheckResult;
        try {
            const userId = userData._id;

            const result = await NotificationService.deleteAllNotifications(userId);
            if (!result) return res.status(404).json({ error: 'No notifications found' });

            return res.status(200).json({ message: 'All notifications deleted' });
        } catch (err) {
            console.error('Delete all notifications error:', err);
            return res.status(500).json({ error: 'Failed to delete all notifications' });
        }
    }

}

export default NotificationController;

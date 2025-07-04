import NotificationService from '../services/NotificationService';
import Notification from '../models/Notifications';

class NotificationSocket {
    /**
     * @param {Socket} socket - The socket instance for this user
     */
    constructor(socket) {
        this.socket = socket;
        this.userId = socket.userId;

        this.registerEvents();
    }

    registerEvents() {
        this.socket.on('notification:read:single', this.markAsRead.bind(this));
        this.socket.on('notification:read:all', this.markAllAsRead.bind(this));
        this.socket.on('notification:delete:single', this.handleDeleteNotification.bind(this));
        this.socket.on('notification:delete:all', this.handleDeleteAllNotifications.bind(this));
    }

    async markAsRead({ notificationId }) {
        try {
            if (!notificationId) return;

            const result = await Notification.updateOne(
                {
                    _id: notificationId,
                    userId: this.userId,
                    'read.status': false,
                },
                {
                    $set: {
                        'read.status': true,
                        'read.readAt': new Date(),
                    }
                }
            );

            if (result.modifiedCount > 0) {
                console.log(`✅ Notification ${notificationId} marked as read for user ${this.userId}`);
                this.socket.emit('notification:read:success', { notificationId });
            } else {
                console.log(`ℹ️ Notification ${notificationId} already read or not found.`);
                this.socket.emit('notification:read:already', { notificationId });
            }
        } catch (err) {
            console.error('❌ Failed to mark notification as read:', err.message);
            this.socket.emit('notification:error', {
                type: 'READ_FAIL',
                notificationId,
                message: 'Could not mark notification as read'
            });
        }
    }

    async markAllAsRead() {
        try {
            const result = await Notification.updateMany(
                {
                    userId: this.userId,
                    'read.status': false,
                },
                {
                    $set: {
                        'read.status': true,
                        'read.readAt': new Date(),
                    }
                }
            );

            if (result.modifiedCount > 0) {
                console.log(`✅ All notifications marked as read for user ${this.userId}`);
                this.socket.emit('notification:read:all:success');
            } else {
                console.log(`ℹ️ No unread notifications found for user ${this.userId}.`);
                this.socket.emit('notification:read:all:no-unread');
            }
        } catch (err) {
            console.error('❌ Failed to mark all notifications as read:', err.message);
            this.socket.emit('notification:error', {
                type: 'READ_ALL_FAIL',
                message: 'Could not mark all notifications as read'
            });
        }

    }

    async handleDeleteNotification({ notificationId }) {
        try {
            if (!notificationId) return;

            const result = await Notification.updateOne(
                { _id: notificationId, userId: this.userId },
                {
                    $set: {
                        'deleted.status': true,
                        'deleted.deletedAt': new Date(),
                    },
                }
            );

            if (result.modifiedCount > 0) {
                console.log(`🗑️ Deleted notification: ${notificationId}`);
                this.socket.emit('notification:delete:success', { notificationId });
            }
        } catch (err) {
            console.error('❌ Error deleting notification:', err.message);
            this.socket.emit('notification:error', {
                type: 'DELETE_FAIL',
                notificationId,
                message: 'Failed to delete notification',
            });
        }
    };

    async handleDeleteAllNotifications() {
        try {
            const result = await Notification.updateMany(
                { userId: this.userId, 'deleted.status': false },
                {
                    $set: {
                        'deleted.status': true,
                        'deleted.deletedAt': new Date(),
                    },
                }
            );

            if (result.modifiedCount > 0) {
                console.log(`🗑️ Deleted all notifications for user ${this.userId}`);
                this.socket.emit('notification:delete:all:success');
            } else {
                console.log(`ℹ️ No notifications to delete for user ${this.userId}.`);
                this.socket.emit('notification:delete:all:no-notifications');
            }
        } catch (err) {
            console.error('❌ Error deleting all notifications:', err.message);
            this.socket.emit('notification:error', {
                type: 'DELETE_ALL_FAIL',
                message: 'Failed to delete all notifications',
            });
        }
    }


}


export default NotificationSocket;
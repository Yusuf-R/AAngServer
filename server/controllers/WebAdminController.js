// controllers/WebAdminController.js
import getConversationModel from "../models/Conversation";
import { Server } from 'socket.io';

let ioInstance = null;

export const setIO = (io) => {
  ioInstance = io;
};


class WebAdminController {
    static async deliverMessage(req, res) {
        try {
            const { conversationId, message } = req.body;

            console.log(`📨 HTTP Fallback: Delivering ADMIN message: ${conversationId}`);

            // Validate request
            if (!conversationId || !message) {
                return res.status(400).json({
                    error: 'Missing required fields: conversationId and message'
                });
            }

            // Get the conversation
            const Conversation = await getConversationModel();
            const conversation = await Conversation.findById(conversationId);
            if (!conversation) {
                return res.status(404).json({ error: 'Conversation not found' });
            }

            // Find the OTHER person (not the sender)
            const otherParticipant = conversation.participants.find(
                p => p.userId.toString() !== message.senderId
            );

            if (!otherParticipant) {
                return res.status(404).json({ error: 'Other participant not found' });
            }

            // Verify the sender is actually in this conversation
            const senderInConversation = conversation.participants.find(
                p => p.userId.toString() === message.senderId
            );

            if (!senderInConversation) {
                return res.status(403).json({ error: 'Sender not in conversation' });
            }

            // Deliver to the other person via socket
            const recipientRoom = `user:${otherParticipant.userId}`;
            console.log('🔔 Emitting to room:', recipientRoom);
            console.log('✅ Event emitted successfully');

            if (!ioInstance) {
                throw new Error('Socket.IO instance not initialized');
            }
            ioInstance.to(recipientRoom).emit('chat:message:new', message);
            ioInstance.to(conversationId).emit('chat:message:new', message);

            console.log(`✅ HTTP: Emitted to user:${otherParticipant.userId} AND ${conversationId}`);
            res.json({
                success: true,
                deliveredTo: otherParticipant.userId,
                method: 'http-fallback',
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('HTTP delivery error:', error);
            res.status(500).json({
                error: 'Failed to deliver message',
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    // Optional: Health check endpoint for webhook
    static async healthCheck(req, res) {
        res.json({
            status: 'healthy',
            service: 'webAdmin-delivery',
            timestamp: new Date().toISOString()
        });
    }
}

export default WebAdminController;
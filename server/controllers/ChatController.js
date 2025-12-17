import getModels from "../models/AAng/AAngLogistics";
import getConversationModel from "../models/Conversation"
import getOrderModels from "../models/Order";
import getMessageModel from "../models/Message"
import AuthController from "./AuthController";

import { Server } from 'socket.io';

let ioInstance = null;

export const setIO = (io) => {
    ioInstance = io;
};

// Helper function to serialize MongoDB documents
const serializeDoc = (doc) => {
    if (!doc) return null;
    if (Array.isArray(doc)) return doc.map(serializeDoc);

    const plain = doc.toObject ? doc.toObject() : doc;
    return JSON.parse(JSON.stringify(plain));
};

const standardRole = (r) => {
    return r.charAt(0).toUpperCase() + r.slice(1)
}

class ChatController {

    static async sendMessage(req, res) {
        console.log('📤 sendMessage called');
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && { tokenExpired: true })
            });
        }

        const { userData } = preCheckResult;
        const { conversationId, messageData } = req.body;

        if (!conversationId || !messageData) {
            return res.status(400).json({
                error: 'Missing required fields: conversationId and messageData'
            });
        }

        const userId = userData._id.toString();
        const userRole = userData.role;

        console.log('📨 Message details:', {
            userId,
            userRole,
            conversationId,
            messageData
        });

        try {
            const Conversation = await getConversationModel();
            const Message = await getMessageModel();
            const { AAngBase } = await getModels();

            // ✅ Update conversation and get updated document
            const conversation = await Conversation.findOneAndUpdate(
                {
                    _id: conversationId,
                    'participants.userId': userId
                },
                {
                    $inc: { nextSeq: 1, messageCount: 1 },
                    $set: {
                        lastMessageAt: new Date(),
                        lastActivityBy: userId
                    }
                },
                { new: true }
            );

            if (!conversation) {
                return res.status(404).json({
                    success: false,
                    error: 'Conversation not found or access denied'
                });
            }

            // ✅ Create the message
            const newMessage = await Message.create({
                conversationId,
                seq: conversation.nextSeq - 1,
                senderId: userId,
                senderRole: standardRole(userRole),
                kind: messageData.kind || 'text',
                body: messageData.body,
                mediaRef: messageData.mediaRef,
                createdAt: new Date()
            });

            console.log('✅ Message saved to DB:', newMessage._id);

            // ====================================================
            // SOCKET.IO REAL-TIME DELIVERY
            // ====================================================

            // ✅ Find the OTHER participant (not the sender)
            const otherParticipant = conversation.participants.find(
                p => p.userId.toString() !== userId
            );

            if (!otherParticipant) {
                console.warn('⚠️ No other participant found in conversation');
                return res.status(200).json({
                    success: true,
                    data: serializeDoc(newMessage),
                    warning: 'Message saved but no recipient found'
                });
            }

            console.log('👤 Found recipient:', otherParticipant.userId.toString());

            // ✅ Verify Socket.IO instance exists
            if (!global.io) {
                console.error('❌ Socket.IO instance not initialized');
                return res.status(200).json({
                    success: true,
                    data: serializeDoc(newMessage),
                    warning: 'Message saved but socket not available'
                });
            }

            // ✅ Emit to recipient's personal room
            const recipientRoom = `user:${otherParticipant.userId}`;
            global.io.to(recipientRoom).emit('chat:message:new', serializeDoc(newMessage));
            console.log(`📡 Emitted to personal room: ${recipientRoom}`);

            // ✅ Emit to conversation room (for active viewers)
            global.io.to(conversationId).emit('chat:message:new', serializeDoc(newMessage));
            console.log(`📡 Emitted to conversation room: ${conversationId}`);

            // ✅ Success response
            return res.status(200).json({
                success: true,
                data: serializeDoc(newMessage),
                delivered: {
                    recipientRoom,
                    conversationRoom: conversationId,
                    recipientId: otherParticipant.userId.toString()
                }
            });

        } catch (error) {
            console.error('❌ Error sending message:', error);
            return res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    /**
     * Get driver's complete chat data:
     * - Support conversation (ADMIN_DRIVER)
     * - Active client conversations (DRIVER_CLIENT)
     */
    static async getOrCreateDriverSupportConversation(req, res) {
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && { tokenExpired: true })
            });
        }

        const { userData } = preCheckResult;

        try {
            const Conversation = await getConversationModel();
            const { Order } = await getOrderModels();
            const Message = await getMessageModel();
            const {AAngBase, Client, Driver, Admin} = await getModels();
            // ====================================================
            // PART 1: Get or Create ADMIN_DRIVER Support Chat
            // ====================================================
            let supportConversation = null;
            let supportMessages = [];
            let adminInfo = null;
            let isNewSupport = false;

            // Check for existing support conversation
            const existingSupportConv = await Conversation.findOne({
                type: 'ADMIN_DRIVER',
                'participants.userId': userData._id,
                status: 'open',
            }).sort({lastMessageAt: -1}).limit(1);

            if (existingSupportConv) {
                // Load existing support conversation
                const adminParticipant = existingSupportConv.participants.find(
                    p => p.role === 'Admin'
                );

                adminInfo = await Admin.findById(adminParticipant.userId)
                    .select('fullName avatar phoneNumber email adminRole')
                    .lean();

                supportMessages = await Message.find({
                    conversationId: existingSupportConv._id,
                    deletedAt: null
                })
                    .sort({createdAt: 1})
                    .limit(50)
                    .lean();

                supportConversation = existingSupportConv;

                console.log(`✅ Found existing support conversation for driver: ${userData._id}`);

            } else {
                // Create new support conversation
                const availableAdmin = await Admin.findOne({
                    status: 'Active',
                    adminRole: {$in: ['customer_support', 'super_admin', 'platform_manager']},
                })
                    .select('_id fullName avatar phoneNumber email adminRole')
                    .lean();

                if (!availableAdmin) {
                    return res.status(503).json({
                        success: false,
                        error: 'No support admin available at the moment. Please try again later.'
                    });
                }

                // Create conversation
                supportConversation = await Conversation.create({
                    type: 'ADMIN_DRIVER',
                    orderId: null,
                    participants: [
                        {userId: availableAdmin._id, role: 'Admin', lastReadSeq: 0},
                        {userId: userData._id, role: 'Driver', lastReadSeq: 0}
                    ],
                    status: 'open',
                    deleteControl: 'ADMIN_ONLY',
                    createdBy: userData._id,
                    lastActivityBy: userData._id
                });

                // Create welcome message
                const welcomeMessage = await Message.create({
                    conversationId: supportConversation._id,
                    seq: 1,
                    senderId: availableAdmin._id,
                    senderRole: 'Admin',
                    kind: 'system',
                    body: `Welcome! You've been connected with ${availableAdmin.fullName} from our support team. How can we help you today?`,
                    createdAt: new Date()
                });

                // Update conversation
                await Conversation.updateOne(
                    {_id: supportConversation._id},
                    {$inc: {nextSeq: 1, messageCount: 1}}
                );

                supportMessages = [welcomeMessage.toObject()];
                adminInfo = availableAdmin;
                isNewSupport = true;

                console.log(`✅ Created new support conversation for driver: ${userData._id}`);
            }

            // ====================================================
            // PART 2: Get Active DRIVER_CLIENT Conversations
            // ====================================================
            const clientConversations = await Conversation.find({
                type: 'DRIVER_CLIENT',
                'participants.userId': userData._id,
                status: 'open',
                orderId: {$ne: null}
            })
                .sort({lastMessageAt: -1})
                .limit(10)
                .lean();

            // Enrich client conversations with client info and messages
            const enrichedClientConversations = await Promise.all(
                clientConversations.map(async (conv) => {
                    try {
                        // Get client participant
                        const clientParticipant = conv.participants.find(
                            p => p.role === 'Client'
                        );

                        if (!clientParticipant) return null;

                        // Get client info
                        const clientInfo = await Client.findById(clientParticipant.userId)
                            .select('fullName avatar phoneNumber email')
                            .lean();

                        if (!clientInfo) return null;

                        // Get order info (for context)


                        const orderInfo = await Order.findById(conv.orderId)
                            .select('orderRef status pickupLocation dropoffLocation')
                            .lean();

                        // Get recent messages
                        const messages = await Message.find({
                            conversationId: conv._id,
                            deletedAt: null
                        })
                            .sort({createdAt: 1})
                            .limit(50)
                            .lean();

                        // Calculate unread count for driver
                        const driverParticipant = conv.participants.find(
                            p => p.userId.toString() === userData._id.toString()
                        );
                        const unreadCount = Math.max(0, conv.messageCount - (driverParticipant?.lastReadSeq || 0));

                        return {
                            conversation: conv,
                            clientInfo,
                            orderInfo,
                            messages,
                            unreadCount
                        };
                    } catch (error) {
                        console.error(`Error enriching client conversation ${conv._id}:`, error);
                        return null;
                    }
                })
            );

            // Filter out null values (failed enrichments)
            const validClientConversations = enrichedClientConversations.filter(c => c !== null);

            console.log(`✅ Found ${validClientConversations.length} active client conversations`);

            // ====================================================
            // PART 3: Return Complete Chat Data
            // ====================================================
            return res.json({
                success: true,
                data: serializeDoc({
                    // Support conversation
                    supportConversation: {
                        conversation: supportConversation,
                        messages: supportMessages,
                        adminInfo,
                        isNew: isNewSupport
                    },

                    // Client conversations
                    clientConversations: validClientConversations,

                    // Summary
                    summary: {
                        totalConversations: 1 + validClientConversations.length,
                        supportAvailable: true,
                        activeClientChats: validClientConversations.length,
                        hasUnreadMessages: validClientConversations.some(c => c.unreadCount > 0)
                    }
                })
            });

        } catch (error) {
            console.error('❌ Error in getOrCreateDriverSupportConversation:', error);
            return res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }


    /**
     * Get or create support conversation for Client
     * Creates ADMIN_CLIENT conversation type
     */
    /**
     * Get or create support conversation for Client
     * Returns:
     * - ADMIN_CLIENT support conversation
     * - Active DRIVER_CLIENT conversations (for ongoing orders)
     */
    static async getOrCreateClientSupportConversation(req, res) {
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && { tokenExpired: true })
            });
        }

        const { userData } = preCheckResult;

        try {
            const Conversation = await getConversationModel();
            const { Order } = await getOrderModels();
            const Message = await getMessageModel();
            const { Admin, Client, Driver } = await getModels();

            // ====================================================
            // PART 1: Get or Create ADMIN_CLIENT Support Chat
            // ====================================================
            let supportConversation = null;
            let supportMessages = [];
            let adminInfo = null;
            let isNewSupport = false;

            // Check for existing support conversation
            const existingSupportConv = await Conversation.findOne({
                type: 'ADMIN_CLIENT',
                'participants.userId': userData._id,
                status: 'open',
            }).sort({ lastMessageAt: -1 }).limit(1);

            if (existingSupportConv) {
                // Load existing support conversation
                const adminParticipant = existingSupportConv.participants.find(
                    p => p.role === 'Admin'
                );

                adminInfo = await Admin.findById(adminParticipant.userId)
                    .select('fullName avatar phoneNumber email adminRole')
                    .lean();

                supportMessages = await Message.find({
                    conversationId: existingSupportConv._id,
                    deletedAt: null
                })
                    .sort({ createdAt: 1 })
                    .limit(50)
                    .lean();

                supportConversation = existingSupportConv;

                console.log(`✅ Found existing support conversation for client: ${userData._id}`);

            } else {
                // Create new support conversation
                const availableAdmin = await Admin.findOne({
                    status: 'Active',
                    adminRole: { $in: ['customer_support', 'super_admin', 'platform_manager'] },
                })
                    .select('_id fullName avatar phoneNumber email adminRole')
                    .lean();

                if (!availableAdmin) {
                    return res.status(503).json({
                        success: false,
                        error: 'No support admin available at the moment. Please try again later.'
                    });
                }

                // Create conversation
                supportConversation = await Conversation.create({
                    type: 'ADMIN_CLIENT',
                    orderId: null,
                    participants: [
                        { userId: availableAdmin._id, role: 'Admin', lastReadSeq: 0 },
                        { userId: userData._id, role: 'Client', lastReadSeq: 0 }
                    ],
                    status: 'open',
                    deleteControl: 'ADMIN_ONLY',
                    createdBy: userData._id,
                    lastActivityBy: userData._id
                });

                // Create welcome message
                const welcomeMessage = await Message.create({
                    conversationId: supportConversation._id,
                    seq: 1,
                    senderId: availableAdmin._id,
                    senderRole: 'Admin',
                    kind: 'system',
                    body: `Welcome! You've been connected with ${availableAdmin.fullName} from our support team. How can we assist you today?`,
                    createdAt: new Date()
                });

                // Update conversation
                await Conversation.updateOne(
                    { _id: supportConversation._id },
                    { $inc: { nextSeq: 1, messageCount: 1 } }
                );

                supportMessages = [welcomeMessage.toObject()];
                adminInfo = availableAdmin;
                isNewSupport = true;

                console.log(`✅ Created new support conversation for client: ${userData._id}`);
            }

            // ====================================================
            // PART 2: Get Active DRIVER_CLIENT Conversations
            // ====================================================
            const driverConversations = await Conversation.find({
                type: 'DRIVER_CLIENT',
                'participants.userId': userData._id,
                status: 'open',
                // Only get conversations with active orders
                orderId: { $ne: null }
            })
                .sort({ lastMessageAt: -1 })
                .limit(10)
                .lean();

            // Enrich driver conversations with driver info and messages
            const enrichedDriverConversations = await Promise.all(
                driverConversations.map(async (conv) => {
                    try {
                        // Get driver participant
                        const driverParticipant = conv.participants.find(
                            p => p.role === 'Driver'
                        );

                        if (!driverParticipant) return null;

                        // Get driver info
                        const driverInfo = await Driver.findById(driverParticipant.userId)
                            .select('fullName avatar phoneNumber email vehicleInfo')
                            .lean();

                        if (!driverInfo) return null;

                        // Get order info (for context)
                        const orderInfo = await Order.findById(conv.orderId)
                            .select('orderRef status pickupLocation dropoffLocation')
                            .lean();

                        // Get recent messages
                        const messages = await Message.find({
                            conversationId: conv._id,
                            deletedAt: null
                        })
                            .sort({ createdAt: 1 })
                            .limit(50)
                            .lean();

                        // Calculate unread count for client
                        const clientParticipant = conv.participants.find(
                            p => p.userId.toString() === userData._id.toString()
                        );
                        const unreadCount = Math.max(0, conv.messageCount - (clientParticipant?.lastReadSeq || 0));

                        return {
                            conversation: conv,
                            driverInfo,
                            orderInfo,
                            messages,
                            unreadCount
                        };
                    } catch (error) {
                        console.error(`Error enriching driver conversation ${conv._id}:`, error);
                        return null;
                    }
                })
            );

            // Filter out null values (failed enrichments)
            const validDriverConversations = enrichedDriverConversations.filter(c => c !== null);

            console.log(`✅ Found ${validDriverConversations.length} active driver conversations for client`);

            // ====================================================
            // PART 3: Return Complete Chat Data
            // ====================================================
            return res.json({
                success: true,
                data: serializeDoc({
                    // Support conversation
                    supportConversation: {
                        conversation: supportConversation,
                        messages: supportMessages,
                        adminInfo,
                        isNew: isNewSupport
                    },

                    // Driver conversations (for active orders)
                    driverConversations: validDriverConversations,

                    // Summary
                    summary: {
                        totalConversations: 1 + validDriverConversations.length,
                        supportAvailable: true,
                        activeDriverChats: validDriverConversations.length,
                        hasUnreadMessages: validDriverConversations.some(c => c.unreadCount > 0)
                    }
                })
            });

        } catch (error) {
            console.error('❌ Error in getOrCreateClientSupportConversation:', error);
            return res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }


    /**
     * Get messages for a conversation (shared utility)
     */
    static async getConversationMessages(req, res) {
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && { tokenExpired: true })
            });
        }

        const { userData } = preCheckResult;
        const { conversationId } = req.params;
        const { limit = 50 } = req.query;

        try {
            const Conversation = await getConversationModel();
            const Message = await getMessageModel();

            // Verify user has access to this conversation
            const conversation = await Conversation.findOne({
                _id: conversationId,
                'participants.userId': userData._id
            });

            if (!conversation) {
                return res.status(404).json({
                    success: false,
                    error: 'Conversation not found or access denied'
                });
            }

            // Get messages
            const messages = await Message.find({
                conversationId,
                deletedAt: null
            })
                .sort({ createdAt: 1 })
                .limit(parseInt(limit))
                .lean();

            return res.json({
                success: true,
                data: serializeDoc(messages)
            });

        } catch (error) {
            console.error('❌ Error getting conversation messages:', error);
            return res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }
}

module.exports = ChatController;
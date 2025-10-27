// server/controllers/SupportTicketController.js
import getTicketModel from '../models/Ticket';
import AuthController from './AuthController';

const serializeDoc = (doc) => {
    if (!doc) return null;
    if (Array.isArray(doc)) return doc.map(serializeDoc);
    const plain = doc.toObject ? doc.toObject() : doc;
    return JSON.parse(JSON.stringify(plain));
};

class TicketController {

    /**
     * Create a new support ticket
     */
    static async createTicket(req, res) {
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && { tokenExpired: true })
            });
        }

        const { userData } = preCheckResult;
        const { subject, description, category, attachments } = req.body;

        if (!subject || !description) {
            return res.status(400).json({
                success: false,
                error: 'Subject and description are required'
            });
        }

        try {
            const Ticket = await getTicketModel();
            // Generate ticketRef in controller
            const generateTicketRef = () => {
                const timestamp = Date.now().toString(36).toUpperCase();
                const random = Math.random().toString(36).substring(2, 6).toUpperCase();
                return `TKT-${timestamp}-${random}`;
            };

            // Create ticket
            const ticket = await Ticket.create({
                userId: userData._id,
                ticketRef: generateTicketRef(),
                userRole: userData.role,
                subject,
                description,
                category: category || 'other',
                priority: 'medium',
                attachments: attachments || [],
                status: 'open',
                userInfo: {
                    fullName: userData.fullName,
                    email: userData.email,
                    phoneNumber: userData.phoneNumber
                }
            });

            console.log(`✅ Created support ticket: ${ticket.ticketRef}`);

            // TODO: Send email notification to support team
            // await EmailService.notifySupportTeam(ticket);

            return res.status(201).json({
                success: true,
                data: serializeDoc(ticket),
                message: 'Your support ticket has been created successfully'
            });

        } catch (error) {
            console.error('❌ Error creating ticket:', error);
            return res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    /**
     * Get user's tickets
     */
    static async getAllUserTicket(req, res) {
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && { tokenExpired: true })
            });
        }

        const { userData } = preCheckResult;
        const { status, page = 1, limit = 20 } = req.query;

        try {
            const Ticket = await getTicketModel();
            const filter = { userId: userData._id };
            if (status) filter.status = status;

            const tickets = await Ticket.find(filter)
                .sort({ createdAt: -1 })
                .skip((page - 1) * limit)
                .limit(parseInt(limit))
                .lean();

            const total = await Ticket.countDocuments(filter);

            return res.json({
                success: true,
                data: {
                    tickets: serializeDoc(tickets),
                    pagination: {
                        page: parseInt(page),
                        limit: parseInt(limit),
                        total,
                        totalPages: Math.ceil(total / limit)
                    }
                }
            });

        } catch (error) {
            console.error('❌ Error fetching tickets:', error);
            return res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    /**
     * Get single ticket details
     */
    static async getTicketById(req, res) {
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && { tokenExpired: true })
            });
        }

        const { userData } = preCheckResult;
        const { ticketId } = req.body;
        if (!ticketId) {
            return res.status(400).json({
                success: false,
                error: 'Ticket ID is required'
            });
        }

        try {
            const Ticket = await getTicketModel();

            const ticket = await Ticket.findOne({
                _id: ticketId,
                userId: userData._id
            }).lean();

            if (!ticket) {
                return res.status(404).json({
                    success: false,
                    error: 'Ticket not found'
                });
            }

            return res.json({
                success: true,
                data: serializeDoc(ticket)
            });

        } catch (error) {
            console.error('❌ Error fetching ticket:', error);
            return res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    static async deleteTicket(req, res) {
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && { tokenExpired: true })
            });
        }

        const { userData } = preCheckResult;
        const { ticketId } = req.body;
        if (!ticketId) {
            return res.status(400).json({
                success: false,
                error: 'Ticket ID is required'
            });
        }
        try {
            const Ticket = await getTicketModel();
            const ticket = await Ticket.findOne({
                _id: ticketId,
                userId: userData._id
            });
            if (!ticket) {
                return res.status(404).json({
                    success: false,
                    error: 'Ticket not found'
                });
            }
            await Ticket.deleteOne({ _id: ticketId });
            return res.json({
                success: true,
                message: 'Ticket deleted successfully'
            });
        } catch (error) {
            console.error('❌ Error deleting ticket:', error);
            return res.status(500).json({
                success: false,
                error: error.message
            });
        }

    }

}

module.exports = TicketController;
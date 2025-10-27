// server/models/SupportTicket.js
import mongoose from "mongoose";

const { Schema, model } = mongoose;

const AttachmentSchema = new Schema({
    filename: { type: String, required: true },
    url: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true }, // bytes
    uploadedAt: { type: Date, default: Date.now }
}, { _id: true });

const TicketSchema = new Schema({
    ticketRef: {
        type: String,
        unique: true,
        required: true,
        index: true
    },
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'Base',
        required: true,
        index: true
    },
    userRole: {
        type: String,
        enum: ['Admin', 'Driver', 'Client'],
        required: true
    },

    // Ticket content
    subject: { type: String, required: true },
    description: { type: String, required: true },
    category: {
        type: String,
        enum: [
            'account_issue',
            'verification_issue',
            'payment_issue',
            'order_issue',
            'technical_issue',
            'feature_request',
            'other'
        ],
        default: 'other'
    },
    priority: {
        type: String,
        enum: ['low', 'medium', 'high', 'urgent'],
        default: 'medium'
    },

    // Attachments
    attachments: [AttachmentSchema],

    // Status tracking
    status: {
        type: String,
        enum: ['open', 'in_progress', 'waiting_response', 'resolved', 'closed'],
        default: 'open',
        index: true
    },

    // Assignment
    assignedTo: { type: Schema.Types.ObjectId, ref: 'Admin' },
    assignedAt: { type: Date },

    // Responses
    responses: [{
        responderId: { type: Schema.Types.ObjectId, ref: 'Base', required: true },
        responderRole: { type: String, enum: ['Admin', 'Driver', 'Client'], required: true },
        responderName: { type: String },
        message: { type: String, required: true },
        attachments: [AttachmentSchema],
        createdAt: { type: Date, default: Date.now },
        isInternal: { type: Boolean, default: false } // Internal admin notes
    }],

    // Metadata
    createdAt: { type: Date, default: Date.now, index: true },
    updatedAt: { type: Date, default: Date.now },
    resolvedAt: { type: Date },
    closedAt: { type: Date },

    // User info snapshot (for quick access)
    userInfo: {
        fullName: String,
        email: String,
        phoneNumber: String
    },

    // Rating
    rating: {
        score: { type: Number, min: 1, max: 5 },
        feedback: String,
        ratedAt: Date
    }
}, {
    timestamps: true,
    versionKey: false
});

// Indexes
TicketSchema.index({ userId: 1, createdAt: -1 });
TicketSchema.index({ status: 1, priority: -1, createdAt: -1 });
TicketSchema.index({ assignedTo: 1, status: 1 });

// Auto-generate ticket reference
TicketSchema.pre('save', async function(next) {
    if (!this.ticketRef) {
        const timestamp = Date.now().toString(36).toUpperCase();
        const random = Math.random().toString(36).substring(2, 6).toUpperCase();
        this.ticketRef = `TKT-${timestamp}-${random}`;
    }
    this.updatedAt = new Date();
    next();
});

// Export function
const getTicketModel = async () => {
    if (mongoose.models.Ticket) {
        return mongoose.models.Ticket;
    }
    return model("Ticket", TicketSchema);
};

export default getTicketModel;
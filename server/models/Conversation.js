// models/Conversation.js
import mongoose from "mongoose";
const { Schema, model } = mongoose;

const ParticipantSchema = new Schema({
    userId: { type: Schema.Types.ObjectId, ref: 'Base', required: true },
    role: { type: String, enum: ["Admin", "Driver", "Client"], required: true },
    lastReadSeq: { type: Number, default: 0 }
}, { _id: false });

const ConversationSchema = new Schema({
    type: {
        type: String,
        enum: ["ADMIN_ADMIN", "ADMIN_CLIENT", "ADMIN_DRIVER", "DRIVER_CLIENT"],
        required: true,
        index: true
    },
    orderId: { type: Schema.Types.ObjectId, default: null },
    participants: {
        type: [ParticipantSchema],
        validate: [v => v.length >= 2, "Must have at least 2 participants"]
    },
    status: { type: String, enum: ["open", "closed"], default: "open", index: true },
    createdAt: { type: Date, default: Date.now, index: true },
    lastMessageAt: { type: Date, default: Date.now, index: true },
    closedAt: { type: Date },
    orderCompletedAt: { type: Date },
    eligibleForCleanupAt: { type: Date, index: true },
    pinned: { type: Boolean, default: false, index: true },
    deleteControl: {
        type: String,
        enum: ["ADMIN_ONLY", "ADMIN_OR_AUTO"],
        required: true
    },
    nextSeq: { type: Number, default: 1 },
    createdBy: { type: Schema.Types.ObjectId },
    lastActivityBy: { type: Schema.Types.ObjectId },
    messageCount: { type: Number, default: 0 }
}, { versionKey: false });

// Indexes
ConversationSchema.index({ type: 1, status: 1, lastMessageAt: -1 });
ConversationSchema.index({ "participants.userId": 1, lastMessageAt: -1 });
ConversationSchema.index({ orderId: 1 }, { sparse: true });
ConversationSchema.index({ deleteControl: 1, eligibleForCleanupAt: 1, status: 1 });

// Export function that ensures model registration
const getConversationModel = async () => {
    if (mongoose.models.Conversation) {
        return mongoose.models.Conversation;
    }
    return model("Conversation", ConversationSchema);
};

export default getConversationModel;
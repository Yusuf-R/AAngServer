// models/Message.js
import mongoose from "mongoose";
const { Schema, model } = mongoose;

const MediaRefSchema = new Schema({
    key: { type: String, required: true },
    mime: { type: String, required: true },
    size: { type: Number, required: true }
}, { _id: false });

const MessageSchema = new Schema({
    conversationId: {
        type: Schema.Types.ObjectId,
        ref: "Conversation",
        required: true,
        index: true
    },
    seq: { type: Number, required: true },
    senderId: { type: Schema.Types.ObjectId, required: true, index: true },
    senderRole: { type: String, enum: ["Admin", "Driver", "Client"], required: true },
    kind: { type: String, enum: ["text", "image", "file", "system"], required: true },
    body: { type: String },
    mediaRef: { type: MediaRefSchema },
    createdAt: { type: Date, default: Date.now },
    deletedAt: { type: Date }
}, { versionKey: false });

// Indexes
MessageSchema.index({ conversationId: 1, seq: 1 }, { unique: true });
MessageSchema.index({ conversationId: 1, createdAt: -1 });

// Export function that ensures model registration
const getMessageModel = async () => {
    if (mongoose.models.Message) {
        return mongoose.models.Message;
    }
    return model("Message", MessageSchema);
};

export default getMessageModel;
import mongoose from 'mongoose';

const { Schema, model, Types } = mongoose;

const WalletTransactionSchema = new Schema({
    type: {
        type: String,
        enum: ['TOP_UP', 'PAYMENT', 'REFUND', 'PAYOUT', 'REVERSAL', 'ADJUSTMENT'],
        required: true,
    },
    amount: {
        type: Number,
        required: true,
    },
    status: {
        type: String,
        enum: ['PENDING', 'SUCCESS', 'FAILED', 'REVERSED'],
        default: 'PENDING',
    },
    method: String, // e.g. 'payStack', 'manual', 'wallet'
    ref: String,
    metadata: {
        type: Object,
        default: {},
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
}, { _id: false });

const WalletSchema = new Schema({
    userId: {
        type: Types.ObjectId,
        required: true,
        ref: 'Base',
        index: true,
        unique: true,
    },

    walletId: {
        type: String,
        required: true,
        unique: true,
    },

    balance: {
        type: Number,
        default: 0,
        min: 0,
    },

    currency: {
        type: String,
        enum: ['NGN'],
        default: 'NGN',
    },

    history: {
        type: [WalletTransactionSchema],
        default: [],
    },

    withdrawable: {
        type: Boolean,
        default: true,
    },

    blocked: {
        type: Boolean,
        default: false,
    },

    lastTopUp: Date,
    lastTransaction: Date,
}, { timestamps: true });

export default mongoose.models.Wallet || model("Wallet", WalletSchema);

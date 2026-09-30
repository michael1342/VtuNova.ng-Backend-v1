const mongoose = require('mongoose');
const { TRANSACTION_STATUSES, WALLET_STATES } = require('../config/constants');

const notificationSchema = new mongoose.Schema({
    eventId: { type: String, maxlength: 160 },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },

    transactionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Transaction'
    },

    category: {
        type: String
    },

    status: {
        type: String,
        enum: Object.values(TRANSACTION_STATUSES)
    },

    walletState: {
        type: String,
        enum: Object.values(WALLET_STATES)
    },

    message: {
        type: String
    },

    type: {
        type: String,
        required: true
    },

    title: {
        type: String
    },

    amount: {
        type: Number
    },
    
    ip: {
        type: String
    },

    device: {
        type: String
    },

    service: {
        type: String
    },

    product_name: {
        type: String
    },

    date: {
        type: Date,
        default: Date.now
    },

    isRead: {
        type: Boolean,
        default: false
    }
}, { timestamps: true });

// Queue jobs can be removed; the persisted transition remains unique.
notificationSchema.index({ eventId: 1 }, {
    unique: true, partialFilterExpression: { eventId: { $type: 'string' } },
});



module.exports = mongoose.model('Notification', notificationSchema);

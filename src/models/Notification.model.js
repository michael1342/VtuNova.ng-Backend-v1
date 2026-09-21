const { required } = require('joi');
const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
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

module.exports = mongoose.model('Notification', notificationSchema);
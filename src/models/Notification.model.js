const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },

    transactionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Transaction',
        required: true
    },

    // category: {
    //     type: String
    // },

    message: {
        type: String
    },

    type: {
        type: String
    },

    title: {
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
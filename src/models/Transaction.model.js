const mongoose = require('mongoose');
// const User = require('./User.model');
const {TRANSACTION_TYPES} = require('../config/constants');

const TransactionSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        // required: true
    },
    transactionReference: {
        type: String,
        // required: true
    },
    transactionId: {
        type: String
    },

    email: {
        type: String
    },

    recipient: {
        type: String
    },

    product_name: {
        type: String
    },

    commission: {
        type: Number
    },

    amount: {
        type: Number,
        // required: true
    },

    currency: {
        type: String,
        // required: true,
        default: 'NGN',
        sparse: true
    },

    status: {
        type: String,
        default: 'pending'
    },

    service: {
        type: String,
        default: 'Deposit'
    },

    type: {
        type: String,
        enum: Object.values(TRANSACTION_TYPES),
        // required: true
    },

    paymentMethod: {
        type: String
    },

    fee: {
        type: Number
    },

    transactionDate: {
        type: Date,
        default: Date.now
    },

    paidAt: {
        type: Date,
        default: Date.now
    },

    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Transaction', TransactionSchema);
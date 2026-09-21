const mongoose = require('mongoose');
// const User = require('./User.model');
const {TRANSACTION_TYPES} = require('../config/constants');

const TransactionSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
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

    status: {
        type: String,
        default: 'pending'
    },

    service: {
        type: String
    },

    type: {
        type: String,
        enum: Object.values(TRANSACTION_TYPES),
        // required: true
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


TransactionSchema.index({email: 1})
TransactionSchema.index({user: 1})
TransactionSchema.index({createdAt: -1})

module.exports = mongoose.model('Transaction', TransactionSchema);
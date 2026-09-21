const mongoose = require('mongoose')

const PaymentSchema = new mongoose.Schema({
    reference: {
        type: String,
        required: true
    },
    accessCode: {
        type: String
    },
    authorizationUrl: {
        type: String,
        required: true
    },
    amount: {
        type: Number,
        required: true
    },
    currency: {
        type: String,
        required: true
    },
    status: {
        type: String,
        required: true
    },
    transactionId: {
        type: String,
        required: true
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
     metadata: {
        type: mongoose.Schema.Types.Mixed
    },
    paymentMethod: {
        type: String
    },
    retryCount: {
        type: Number,
        default: 0,
    },
    paidAt: Date,
    createdAt: {
        type: Date,
        default: Date.now
    }
}, {timestamps: true})


PaymentSchema.index({reference: 1})
PaymentSchema.index({status: 1})
PaymentSchema.index({createdAt: -1})

module.exports = mongoose.model('Payment', PaymentSchema);
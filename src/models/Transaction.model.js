const mongoose = require('mongoose');
const { TRANSACTION_TYPES, TRANSACTION_STATUSES, WALLET_STATES } = require('../config/constants');

const isVtuPurchase = function () {
    return [2, 3].includes(this.flowVersion);
};

const TransactionSchema = new mongoose.Schema({
    //--------------IDENTITY AND LEGACY TRANSACTION DETAILS--------------//
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: isVtuPurchase
    },
    transactionId: String,
    transactionReference: String,
    requestId: { type: String, required: isVtuPurchase, maxlength: 128 },
    requestFingerprint: { type: String, required: isVtuPurchase, match: /^[a-f0-9]{64}$/ },
    provider: { type: String, required: isVtuPurchase },
    // Older records must never be picked up by the reservation reconciler.
    flowVersion: { type: Number, enum: [1, 2, 3], default: 1 },
    type: { type: String, enum: Object.values(TRANSACTION_TYPES), required: isVtuPurchase },
    email: String,
    recipient: String,
    product_name: String,
    service: String,
    commission: Number,

    //--------------PURCHASE DETAILS (AMOUNTS ARE IN NAIRA)--------------//
    amount: {
        type: Number,
        required: isVtuPurchase,
        min: 0,
        validate: {
            validator(value) {
                return !isVtuPurchase.call(this) ||
                    (Number.isSafeInteger(value) && value > 0 && Number.isSafeInteger(value * 100));
            },
            message: 'VTU amount must be a positive whole-naira value'
        }
    },
    phone: { type: String, required: isVtuPurchase },
    serviceID: String,
    variation_code: String,
    billersCode: String,
    paymentCode: String,

    //--------------SETTLEMENT AND PROVIDER RESULT--------------//
    status: { type: String, enum: Object.values(TRANSACTION_STATUSES), default: 'pending' },
    walletState: { type: String, enum: Object.values(WALLET_STATES), required: isVtuPurchase },
    providerCode: { type: String, maxlength: 32 },
    providerStatus: { type: String, maxlength: 64 },
    providerReference: { type: String, maxlength: 160 },
    purchasedCode: { type: String, maxlength: 4096 },
    lastProviderError: { type: String, maxlength: 80 },
    submittedAt: Date,
    settledAt: Date,
    paidAt: Date,

    //--------------PENDING PURCHASE RECONCILIATION--------------//
    nextCheckAt: Date,
    lastCheckedAt: Date,
    reviewAfter: Date,
    needsReview: { type: Boolean, default: false },
    checkAttempts: { type: Number, min: 0, default: 0 },
    checkLeaseToken: String,
    checkLeaseUntil: Date
}, { timestamps: true });

TransactionSchema.index({ email: 1 });
TransactionSchema.index({ user: 1, createdAt: -1 });
TransactionSchema.index({ createdAt: -1 });
TransactionSchema.index({ transactionReference: 1 });
TransactionSchema.index(
    { provider: 1, requestId: 1 },
    {
        unique: true,
        partialFilterExpression: {
            provider: { $type: 'string' },
            requestId: { $type: 'string' },
        },
    }
);
TransactionSchema.index({ status: 1, needsReview: 1, nextCheckAt: 1 });
TransactionSchema.index({ flowVersion: 1, status: 1, walletState: 1, needsReview: 1, nextCheckAt: 1 });

module.exports = mongoose.model('Transaction', TransactionSchema);

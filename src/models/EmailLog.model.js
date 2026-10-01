'use strict';

const mongoose = require('mongoose');

//--------------EXISTING EMAIL LOG COLLECTION / DURABLE OUTBOX--------------//
const emailLogSchema = new mongoose.Schema({
    to: { type: String, required: true },
    from: String,
    subject: { type: String, required: true },
    template: { type: String, required: true },
    provider: { type: String, enum: ['resend', 'smtp'], required: true },
    dedupeKey: { type: String, required: true },
    jobId: { type: String, required: true },
    providerMessageId: String,
    triggeredBy: String,
    relatedUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    status: { type: String, enum: ['queued', 'sending', 'retrying', 'accepted', 'failed', 'expired'], default: 'queued' },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, required: true },
    backoffMs: { type: Number, required: true },
    firstAttemptAt: Date,
    lastAttemptAt: Date,
    enqueuedAt: Date,
    acceptedAt: Date,
    failedAt: Date,
    expiredAt: Date,
    expiresAt: Date,
    nextAttemptAt: Date,
    nextRecoveryAt: { type: Date, default: Date.now },
    leaseToken: String,
    leaseUntil: Date,
    acceptanceUncertain: { type: Boolean, default: false },
    needsReview: { type: Boolean, default: false },
    failure: {
        code: String, retryable: Boolean, ambiguous: Boolean,
        statusCode: Number, at: Date,
    },
    // AES-256-GCM snapshot: never plaintext renderContext, OTP, token or body.
    payload: { type: String, select: false },
    payloadExpiresAt: Date,
    purgeAt: { type: Date, required: true },
}, { timestamps: true });

// Partial uniqueness allows old log documents without a dedupe key to coexist.
emailLogSchema.index({ dedupeKey: 1 }, {
    unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } },
});
emailLogSchema.index({ status: 1, nextRecoveryAt: 1, leaseUntil: 1 });
emailLogSchema.index({ payloadExpiresAt: 1 });
emailLogSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });
emailLogSchema.set('toJSON', { transform: (_, result) => { delete result.payload; return result; } });

module.exports = mongoose.model('emailLog', emailLogSchema);

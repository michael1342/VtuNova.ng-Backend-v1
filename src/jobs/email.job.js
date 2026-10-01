'use strict';

const crypto = require('node:crypto');
const { UnrecoverableError, DelayedError } = require('bullmq');
const config = require('../config/email');
const payloadCipher = require('../utils/email-payload');
const { DeliveryError, classify, failure } = require('../utils/email-errors');

const OPEN = ['queued', 'sending', 'retrying'];
const TERMINAL = ['accepted', 'failed', 'expired'];
const writeOptions = { writeConcern: { w: 'majority' } };
const availableLease = (now) => ({ $or: [{ leaseUntil: null }, { leaseUntil: { $lte: now } }] });

//--------------DURABLE INTENT, QUEUE REPAIR AND ATTEMPT ACCOUNTING--------------//
class EmailJobs {
    constructor({ model, queue, service, templates, brand, credentials, logger, settings = config, clock = () => new Date() }) {
        Object.assign(this, { model, queue, service, templates, brand, credentials, logger, settings, clock });
    }

    async enqueue(template, recipient, data, meta = {}) {
        if (!meta.dedupeKey && !meta.eventId) throw new DeliveryError('email_dedupe_key_required');
        const to = String(recipient || '').trim().toLowerCase();
        const dedupeKey = crypto.createHash('sha256')
            .update(JSON.stringify([template, to, String(meta.dedupeKey || meta.eventId)])).digest('hex');
        let log = await this.model.findOne({ dedupeKey });
        if (!log) {
            const provider = process.env.EMAIL_PROVIDER || 'resend';
            if (!['resend', 'smtp'].includes(provider)) throw new DeliveryError('email_provider_invalid');
            const expiresAt = meta.expiresAt ? new Date(meta.expiresAt) : null;
            const sensitive = ['emailVerification', 'passwordReset'].includes(template);
            if (sensitive && (!meta.credential || !expiresAt || !Number.isFinite(expiresAt.getTime()))) {
                throw new DeliveryError('email_credential_metadata_required');
            }
            const now = this.clock();
            const source = provider === 'resend' ? process.env.RESEND_FROM : process.env.SMTP_FROM || process.env.SMTP_USER;
            const from = !source ? '' : source.includes('<') ? source : '"' + this.brand.name.replace(/["\r\n]/g, '') + '" <' + source + '>';
            const rendered = this.templates.render(template, data);
            const request = { from, to: [to], subject: rendered.subject, text: rendered.text, html: rendered.html };
            const payload = payloadCipher.encrypt({ request, credential: meta.credential || null }, dedupeKey);
            const intent = {
                to, from, subject: rendered.subject, template, provider, dedupeKey,
                jobId: 'email-' + dedupeKey, status: 'queued',
                triggeredBy: meta.triggeredBy, relatedUser: meta.relatedUser,
                attempts: 0, maxAttempts: this.settings.maxAttempts, backoffMs: this.settings.backoffMs,
                expiresAt, payload, payloadExpiresAt: new Date(Math.min(
                    now.getTime() + this.settings.payloadRetentionMs, expiresAt?.getTime() ?? Infinity)),
                purgeAt: new Date(now.getTime() + this.settings.retentionDays * 86400000),
                nextRecoveryAt: now,
            };
            try {
                log = await this.model.findOneAndUpdate({ dedupeKey }, { $setOnInsert: intent },
                    { ...writeOptions, upsert: true, new: true, setDefaultsOnInsert: true });
            } catch (error) {
                if (error.code !== 11000) throw new DeliveryError('email_persistence_failed');
                log = await this.model.findOne({ dedupeKey });
                if (!log) throw new DeliveryError('email_persistence_failed');
            }
        }
        // Existing retrying/sending work belongs to BullMQ or the leased recovery sweep.
        if (log.status === 'queued' && log.attempts === 0) {
            try {
                await this.add(log);
            } catch {
                this.logger.warn('Email intent persisted; enqueue recovery required', { emailId: String(log._id) });
            }
        }
        return { emailId: String(log._id), jobId: log.jobId, status: log.status };
    }

    async add(log) {
        const remaining = log.maxAttempts - log.attempts;
        if (remaining <= 0) return;
        await this.queue.add('deliverEmail', { emailId: String(log._id) }, {
            jobId: log.jobId, attempts: remaining,
            backoff: { type: 'email', delay: log.backoffMs },
            delay: Math.max(0, new Date(log.nextAttemptAt || 0).getTime() - this.clock().getTime()),
        });
        await this.model.updateOne({ _id: log._id, status: { $in: OPEN } },
            { $set: { enqueuedAt: this.clock() } }, writeOptions);
    }

    async finish(log, status, details = {}, token) {
        const now = this.clock();
        const filter = { _id: log._id, status: { $in: OPEN } };
        if (token) filter.leaseToken = token;
        const result = await this.model.updateOne(filter, {
            $set: { status, [status + 'At']: now, ...details },
            $unset: { payload: 1, leaseToken: 1, leaseUntil: 1, nextAttemptAt: 1 },
        }, writeOptions);
        if (!result.matchedCount) throw new DeliveryError('email_claim_lost', { retryable: true });
    }

    async release(log, token) {
        await this.model.updateOne({ _id: log._id, leaseToken: token },
            { $unset: { leaseToken: 1, leaseUntil: 1 } }, writeOptions);
    }

    async defer(job, token, at) {
        await job.moveToDelayed(new Date(at).getTime(), token);
        throw new DelayedError();
    }

    stopReason(log, now) {
        if (log.expiresAt && new Date(log.expiresAt) <= now) return 'credential_expired';
        if (log.provider === 'resend' && log.firstAttemptAt &&
            now - new Date(log.firstAttemptAt) >= this.settings.idempotencyWindowMs) return 'idempotency_window_expired';
        if (log.payloadExpiresAt && new Date(log.payloadExpiresAt) <= now) return 'email_payload_expired';
        if (log.provider === 'smtp' && log.acceptanceUncertain) return 'smtp_acceptance_unknown';
        if (log.attempts >= log.maxAttempts) return 'email_attempts_exhausted';
        return null;
    }

    // A Redis receipt survives provider acceptance followed by a MongoDB outage.
    // It contains no body or credentials and is applied before expiry/attempt checks.
    async applyReceipt(log, job, token) {
        const receipt = job.data.receipt;
        if (!receipt) return false;
        if (receipt.status === 'accepted') {
            await this.finish(log, 'accepted', {
                providerMessageId: receipt.providerMessageId, acceptedAt: new Date(receipt.at),
                acceptanceUncertain: false, needsReview: false, failure: null,
            }, token);
        } else if (receipt.status === 'failed') {
            await this.finish(log, 'failed', { failure: receipt.failure,
                acceptanceUncertain: Boolean(receipt.failure.ambiguous), needsReview: Boolean(receipt.failure.ambiguous) }, token);
        } else if (receipt.status === 'retrying' && receipt.attempt === log.attempts) {
            // Preserve provider Retry-After even if the previous Mongo update failed.
            const details = { status: 'retrying', failure: receipt.failure,
                acceptanceUncertain: Boolean(receipt.failure.ambiguous),
                nextAttemptAt: new Date(receipt.nextAttemptAt) };
            const updated = await this.model.updateOne({ _id: log._id, leaseToken: token },
                { $set: details }, writeOptions);
            if (!updated.matchedCount) throw new DeliveryError('email_claim_lost', { retryable: true });
            Object.assign(log, details);
            return false;
        } else return false;
        return true;
    }

    async saveReceipt(job, receipt) {
        try {
            await job.updateData({ emailId: job.data.emailId, receipt });
        } catch {
            // MongoDB is still tried below. If both stores fail, the persisted
            // sending marker is ambiguous; replay is provider/window/budget gated.
            this.logger.error('Email outcome receipt unavailable', { emailId: job.data.emailId });
        }
    }

    async process(job, bullToken) {
        let log;
        let token;
        try {
            log = await this.model.findById(job.data.emailId).select('+payload');
            if (!log) throw new UnrecoverableError('email_intent_missing');
            if (TERMINAL.includes(log.status)) return { status: log.status };
            token = crypto.randomUUID();
            log = await this.model.findOneAndUpdate({ _id: log._id, status: { $in: OPEN }, ...availableLease(this.clock()) },
                { $set: { leaseToken: token, leaseUntil: new Date(this.clock().getTime() + this.settings.leaseMs) } },
                { ...writeOptions, new: true }).select('+payload');
            if (!log) return this.defer(job, bullToken, this.clock().getTime() + this.settings.leaseMs);
            if (await this.applyReceipt(log, job, token)) return { status: job.data.receipt.status };

            const now = this.clock();
            const stop = this.stopReason(log, now);
            if (stop) {
                const expired = stop.endsWith('expired');
                await this.finish(log, expired ? 'expired' : 'failed', {
                    failure: failure(new DeliveryError(stop, { ambiguous: Boolean(log.acceptanceUncertain) }), now),
                    needsReview: Boolean(log.acceptanceUncertain),
                }, token);
                if (!expired) throw new UnrecoverableError(stop);
                return { status: 'expired' };
            }
            if (log.nextAttemptAt && new Date(log.nextAttemptAt) > now) {
                await this.release(log, token);
                return this.defer(job, bullToken, log.nextAttemptAt);
            }
            let snapshot;
            try {
                snapshot = payloadCipher.decrypt(log.payload, log.dedupeKey);
            } catch {
                await this.finish(log, 'failed', { failure: failure(new DeliveryError('email_payload_unreadable')) }, token);
                throw new UnrecoverableError('email_payload_unreadable');
            }
            if (!await this.credentials.isCurrent(snapshot.credential, log.to, now)) {
                await this.finish(log, 'expired', { failure: failure(new DeliveryError('credential_superseded_or_used')) }, token);
                return { status: 'expired' };
            }
            if (log.expiresAt && new Date(log.expiresAt) <= this.clock()) {
                await this.finish(log, 'expired', { failure: failure(new DeliveryError('credential_expired')) }, token);
                return { status: 'expired' };
            }
            // Renew ownership and persist the attempt BEFORE crossing the provider boundary.
            log = await this.model.findOneAndUpdate({
                _id: log._id, leaseToken: token, leaseUntil: { $gt: this.clock() },
                attempts: { $lt: log.maxAttempts },
            }, { $inc: { attempts: 1 }, $set: {
                status: 'sending', lastAttemptAt: this.clock(),
                firstAttemptAt: log.firstAttemptAt || this.clock(),
                acceptanceUncertain: true,
                leaseUntil: new Date(this.clock().getTime() + this.settings.leaseMs),
            } }, { ...writeOptions, new: true });
            if (!log) throw new DeliveryError('email_claim_lost', { retryable: true });

            let accepted;
            try {
                if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(log.to)) throw new DeliveryError('email_recipient_invalid');
                accepted = await this.service.deliver(log, snapshot.request);
            } catch (rawError) {
                const error = classify(rawError, log.provider);
                const lastBullAttempt = job.attemptsMade + 1 >= job.opts.attempts;
                const retry = error.retryable && log.attempts < log.maxAttempts && !lastBullAttempt;
                if (!retry) {
                    const details = failure(error, this.clock());
                    await this.saveReceipt(job, { status: 'failed', failure: details });
                    await this.finish(log, 'failed', { failure: details, acceptanceUncertain: error.ambiguous,
                        needsReview: error.ambiguous }, token);
                    throw new UnrecoverableError(error.code);
                }
                const delay = Math.max(log.backoffMs * 2 ** (log.attempts - 1), error.retryAfterMs);
                error.retryAfterMs = delay;
                const nextAttemptAt = new Date(this.clock().getTime() + delay);
                const details = failure(error, this.clock());
                await this.saveReceipt(job, { status: 'retrying', attempt: log.attempts,
                    failure: details, nextAttemptAt: nextAttemptAt.toISOString() });
                const updated = await this.model.updateOne({ _id: log._id, leaseToken: token }, {
                    $set: { status: 'retrying', failure: details,
                        acceptanceUncertain: error.ambiguous,
                        nextAttemptAt },
                    $unset: { leaseToken: 1, leaseUntil: 1 },
                }, writeOptions);
                if (!updated.matchedCount) throw new DeliveryError('email_claim_lost', { retryable: true });
                throw error; // BullMQ alone schedules delivery retries.
            }
            const receipt = { status: 'accepted', providerMessageId: accepted.providerMessageId, at: this.clock().toISOString() };
            await this.saveReceipt(job, receipt);
            await this.finish(log, 'accepted', { providerMessageId: receipt.providerMessageId,
                acceptedAt: new Date(receipt.at), acceptanceUncertain: false, needsReview: false, failure: null }, token);
            this.logger.info('Email accepted by provider', { emailId: String(log._id), provider: log.provider });
            return { status: 'accepted', providerMessageId: receipt.providerMessageId };
        } catch (error) {
            // Never let raw DB/provider exceptions (which may contain payloads) enter BullMQ logs.
            if (error instanceof UnrecoverableError || error instanceof DelayedError) throw error;
            if (error instanceof DeliveryError) throw error;
            throw new DeliveryError('email_tracking_unavailable', { retryable: true,
                retryAfterMs: Math.max(0, new Date(job.data.receipt?.nextAttemptAt || 0).getTime() - this.clock().getTime()) });
        } finally {
            // A failed release leaves a bounded lease for recovery; do not hide the outcome.
            if (log && token) await this.release(log, token).catch(() => {});
        }
    }

    //--------------BOUNDED SWEEP: INSPECT REDIS, CLAIM MONGO, NEVER SEND--------------//
    async recover(batchSize = this.settings.batchSize) {
        const limit = Math.max(1, Math.min(Number(batchSize) || this.settings.batchSize, this.settings.batchSize));
        let repaired = 0;
        for (let index = 0; index < limit; index++) {
            const now = this.clock();
            const token = crypto.randomUUID();
            const log = await this.model.findOneAndUpdate({
                status: { $in: OPEN }, nextRecoveryAt: { $lte: now }, ...availableLease(now),
            }, { $set: { leaseToken: token, leaseUntil: new Date(now.getTime() + this.settings.leaseMs),
                nextRecoveryAt: new Date(now.getTime() + this.settings.recoveryIntervalMs) } },
            { ...writeOptions, new: true, sort: { nextRecoveryAt: 1 } });
            if (!log) break;
            try {
                const job = await this.queue.getJob(log.jobId);
                const state = job ? await job.getState() : 'missing';
                // Active/delayed/waiting jobs remain exclusively BullMQ's responsibility.
                if (!['missing', 'failed', 'completed', 'unknown'].includes(state)) continue;
                if (job && await this.applyReceipt(log, job, token)) { repaired++; continue; }
                const stop = this.stopReason(log, now);
                if (stop || ['failed', 'completed'].includes(state)) {
                    const code = stop || 'email_queue_' + state;
                    await this.finish(log, stop?.endsWith('expired') ? 'expired' : 'failed', {
                        failure: failure(new DeliveryError(code, { ambiguous: Boolean(log.acceptanceUncertain) }), now),
                        needsReview: Boolean(log.acceptanceUncertain),
                    }, token);
                    continue;
                }
                // Missing Redis job: retain Mongo attempt budget and nextAttemptAt.
                // Deterministic IDs also protect concurrent enqueue/recovery.
                await this.add(log);
                repaired++;
            } finally {
                await this.release(log, token);
            }
        }
        // Bounded physical cleanup even when expired payloads belong to delayed jobs.
        const stale = await this.model.find({ payloadExpiresAt: { $lte: this.clock() }, payload: { $exists: true },
            ...availableLease(this.clock()) }).select('_id').limit(limit);
        for (const log of stale) {
            await this.model.updateOne({ _id: log._id, ...availableLease(this.clock()) }, { $unset: { payload: 1 } }, writeOptions);
        }
        return { repaired };
    }
}

//--------------LAZY RUNTIME WIRING / NO CONNECTIONS IN UNIT TESTS--------------//
let runtime;
function instance() {
    if (!runtime) runtime = new EmailJobs({
        model: require('../models/EmailLog.model'), queue: require('../queue/email.queue').emailQueue,
        service: require('../services/email.service'), templates: require('../templates'),
        brand: require('../templates/layout').BRAND, credentials: require('../services/email-credential.service'),
        logger: require('../utils/logger'),
    });
    return runtime;
}
module.exports = {
    EmailJobs,
    enqueue: (...args) => instance().enqueue(...args),
    process: (...args) => instance().process(...args),
    recover: (...args) => instance().recover(...args),
};

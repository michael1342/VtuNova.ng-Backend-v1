'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { UnrecoverableError, DelayedError } = require('bullmq');
const { load, logger } = require('../test-support/vtu');
const { EmailJobs } = require('../src/jobs/email.job');
const cipher = require('../src/utils/email-payload');
const { DeliveryError, classify, backoff, retryAfter } = require('../src/utils/email-errors');
const EmailLog = require('../src/models/EmailLog.model');

process.env.EMAIL_PROVIDER = 'resend';
process.env.RESEND_FROM = 'VtuNova <hello@example.test>';
process.env.RESEND_API_KEY = 'test-key-never-used-on-network';
process.env.EMAIL_PAYLOAD_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');

const clone = (value) => value == null ? value : structuredClone(value);
function matches(record, filter) {
    return Object.entries(filter).every(([key, expected]) => {
        if (key === '$or') return expected.some((part) => matches(record, part));
        const value = record[key];
        if (expected === null) return value == null;
        if (expected && expected.constructor === Object) return Object.entries(expected).every(([op, item]) => {
            if (op === '$in') return item.includes(value);
            if (op === '$lte') return value != null && value <= item;
            if (op === '$lt') return value != null && value < item;
            if (op === '$gt') return value != null && value > item;
            if (op === '$exists') return (value !== undefined) === item;
            throw new Error('Unsupported filter: ' + op);
        });
        return String(value) === String(expected);
    });
}
function query(get) {
    let count = Infinity;
    return { select() { return this; }, limit(value) { count = value; return this; },
        then(resolve, reject) {
            return Promise.resolve().then(get).then((value) => clone(Array.isArray(value) ? value.slice(0, count) : value)).then(resolve, reject);
        } };
}
function harness() {
    const records = [];
    const jobs = new Map();
    const calls = [];
    const logs = [];
    let time = new Date('2026-10-01T10:00:00Z');
    const state = { failCreate: false, failAdd: false, failStatus: null, current: true, renderCount: 0 };
    const update = (record, changes) => {
        if (changes.$set?.status === state.failStatus) { state.failStatus = null; throw new Error('SECRET database error'); }
        Object.assign(record, clone(changes.$set || {}));
        for (const [key, value] of Object.entries(changes.$inc || {})) record[key] = (record[key] || 0) + value;
        for (const key of Object.keys(changes.$unset || {})) delete record[key];
        return record;
    };
    const model = {
        findOne(filter) { return query(() => records.find((r) => matches(r, filter)) || null); },
        findById(id) { return this.findOne({ _id: id }); },
        find(filter) { return query(() => records.filter((r) => matches(r, filter))); },
        findOneAndUpdate(filter, changes, options = {}) {
            return query(() => {
                let record = records.find((r) => matches(r, filter));
                if (!record && options.upsert) {
                    if (state.failCreate) throw new Error('SECRET persistence error');
                    record = { _id: String(records.length + 1), createdAt: time, ...clone(changes.$setOnInsert) };
                    records.push(record);
                }
                return record ? update(record, changes) : null;
            });
        },
        async updateOne(filter, changes) {
            const record = records.find((r) => matches(r, filter));
            if (record) update(record, changes);
            return { matchedCount: record ? 1 : 0 };
        },
    };
    const queue = {
        async add(name, data, opts) {
            if (state.failAdd) throw new Error('SECRET Redis error');
            if (!jobs.has(opts.jobId)) jobs.set(opts.jobId, {
                name, id: opts.jobId, data: clone(data), opts, attemptsMade: 0, state: opts.delay ? 'delayed' : 'waiting',
                async updateData(value) { this.data = clone(value); },
                async getState() { return this.state; },
                async moveToDelayed(at) { this.state = 'delayed'; this.delayedUntil = at; },
            });
            return jobs.get(opts.jobId);
        },
        async getJob(id) { return jobs.get(id); },
    };
    const service = { async deliver(log, request) {
        calls.push({ log: clone(log), request: clone(request) });
        if (state.providerError) throw state.providerError;
        return { providerMessageId: 'provider-123' };
    } };
    const settings = { maxAttempts: 3, backoffMs: 10000, leaseMs: 120000, batchSize: 50,
        payloadRetentionMs: 86400000, retentionDays: 180, recoveryIntervalMs: 60000,
        idempotencyWindowMs: 86100000 };
    const email = new EmailJobs({ model, queue, service,
        templates: { render(template, data) { state.renderCount++; return {
            subject: template, text: 'OTP ' + (data.otp || ''), html: '<p>' + (data.otp || 'welcome') + '</p>',
        }; } }, brand: { name: 'VtuNova' }, credentials: { async isCurrent() { return state.current; } },
        logger: Object.fromEntries(['info', 'warn', 'error'].map((level) => [level, (...args) => logs.push(args)])),
        settings, clock: () => new Date(time),
    });
    return { email, records, jobs, calls, logs, state, model, queue, settings,
        advance(ms) { time = new Date(time.getTime() + ms); },
        async enqueue(template = 'welcome', data = {}, meta = {}) {
            await email.enqueue(template, 'User@Example.test', data, { dedupeKey: 'event-1', ...meta });
            return jobs.get(records[0].jobId);
        },
    };
}

test('persists encrypted immutable intent before enqueue and records provider acceptance', async () => {
    const h = harness();
    const job = await h.enqueue();
    assert.deepEqual(job.data, { emailId: '1' });
    assert.equal(h.calls.length, 0);
    assert.equal(h.records[0].status, 'queued');
    assert.match(h.records[0].jobId, /^email-[a-f0-9]{64}$/);
    assert.equal(await h.email.process(job).then((r) => r.status), 'accepted');
    assert.equal(h.records[0].attempts, 1);
    assert.equal(h.records[0].providerMessageId, 'provider-123');
    assert.equal(h.records[0].payload, undefined);
    assert.equal(h.records[0].status, 'accepted');
    assert.equal(h.records[0].failure, null);
});

test('MongoDB persistence failure never enqueues or sends', async () => {
    const h = harness();
    h.state.failCreate = true;
    await assert.rejects(h.enqueue(), /email_persistence_failed/);
    assert.equal(h.jobs.size, 0);
    assert.equal(h.calls.length, 0);
});

test('concurrent duplicate events share one record/job and recipient is part of identity', async () => {
    const h = harness();
    await Promise.all(Array.from({ length: 10 }, () => h.enqueue()));
    assert.equal(h.records.length, 1);
    assert.equal(h.jobs.size, 1);
    await h.email.enqueue('welcome', 'different@example.test', {}, { dedupeKey: 'event-1' });
    assert.equal(h.records.length, 2);
    const job = h.jobs.get(h.records[0].jobId);
    await h.email.process(job);
    await h.email.process(job);
    await h.enqueue();
    assert.equal(h.calls.length, 1);
});

test('transient errors reach BullMQ; retries preserve request, key and selected provider', async () => {
    const h = harness();
    const job = await h.enqueue();
    h.state.providerError = classify({ name: 'rate_limit_exceeded', statusCode: 429 }, 'resend', { 'retry-after': '60' });
    await assert.rejects(h.email.process(job), (error) => error.retryable && error.retryAfterMs === 60000);
    assert.equal(h.records[0].status, 'retrying');
    assert.equal(h.records[0].attempts, 1);
    assert.equal(backoff(1, 'email', h.state.providerError, job), 60000);
    assert.equal(backoff(2, 'email', null, job), 20000);
    await assert.rejects(h.email.process(job), DelayedError);
    assert.equal(h.calls.length, 1);
    h.advance(60000);
    job.attemptsMade++;
    h.state.providerError = null;
    process.env.EMAIL_PROVIDER = 'smtp';
    try { await h.email.process(job); } finally { process.env.EMAIL_PROVIDER = 'resend'; }
    assert.deepEqual(h.calls[0].request, h.calls[1].request);
    assert.equal(h.calls[0].log.dedupeKey, h.calls[1].log.dedupeKey);
    assert.equal(h.calls[1].log.provider, 'resend');
    assert.equal(h.state.renderCount, 1);
    assert.equal(h.records[0].attempts, 2);
});

test('permanent credentials/domain/recipient errors fail once without raw failure details', async () => {
    for (const status of [400, 401, 403, 409, 422]) {
        const h = harness();
        const job = await h.enqueue();
        h.state.providerError = { statusCode: status, message: 'SECRET token and body' };
        await assert.rejects(h.email.process(job), UnrecoverableError);
        assert.equal(h.records[0].status, 'failed');
        assert.equal(h.records[0].attempts, 1);
        assert.equal(h.records[0].failure.retryable, false);
        assert.doesNotMatch(JSON.stringify([h.records, h.logs, job.data]), /SECRET/);
        await h.email.process(job);
        assert.equal(h.calls.length, 1);
    }
});

test('invalid recipient is tracked and rejected before provider call', async () => {
    const h = harness();
    await h.email.enqueue('welcome', 'invalid', {}, { dedupeKey: 'invalid' });
    await assert.rejects(h.email.process([...h.jobs.values()][0]), /email_recipient_invalid/);
    assert.equal(h.records[0].status, 'failed');
    assert.equal(h.calls.length, 0);
});

test('OTP payload is encrypted, credential expiry/supersession stops delivery and removes payload', async () => {
    for (const expired of [true, false]) {
        const h = harness();
        const job = await h.enqueue('emailVerification', { otp: '123456' }, {
            credential: { kind: 'otp', id: 'credential-1', purpose: 'email_verification' },
            expiresAt: '2026-10-01T10:05:00Z',
        });
        assert.doesNotMatch(h.records[0].payload, /123456/);
        assert.equal(cipher.decrypt(h.records[0].payload, h.records[0].dedupeKey).credential.id, 'credential-1');
        assert.throws(() => cipher.decrypt(h.records[0].payload, 'wrong-key'));
        if (expired) h.advance(300001); else h.state.current = false;
        await h.email.process(job);
        assert.equal(h.records[0].status, 'expired');
        assert.equal(h.records[0].attempts, 0);
        assert.equal(h.records[0].payload, undefined);
        assert.equal(h.calls.length, 0);
    }
});

test('OTP retries never regenerate a code; expiry between attempts skips retry', async () => {
    const h = harness();
    const job = await h.enqueue('emailVerification', { otp: '123456' }, {
        credential: { kind: 'otp', id: 'v1', purpose: 'email_verification' }, expiresAt: '2026-10-01T10:00:05Z',
    });
    h.state.providerError = new DeliveryError('timeout', { retryable: true, ambiguous: true });
    await assert.rejects(h.email.process(job));
    h.advance(10000);
    await h.email.process(job);
    assert.equal(h.records[0].status, 'expired');
    assert.equal(h.calls.length, 1);
    assert.equal(h.state.renderCount, 1);
});

test('sensitive templates require credential metadata and stable event identity', async () => {
    const h = harness();
    await assert.rejects(h.enqueue('emailVerification', { otp: '123456' }), /email_credential_metadata_required/);
    await assert.rejects(h.email.enqueue('welcome', 'a@example.test', {}), /email_dedupe_key_required/);
    assert.equal(h.records.length, 0);
});

test('enqueue outage is recovered through same deterministic queue without provider call', async () => {
    const h = harness();
    h.state.failAdd = true;
    await h.enqueue();
    assert.equal(h.records.length, 1);
    assert.equal(h.jobs.size, 0);
    h.state.failAdd = false;
    await Promise.all([h.email.recover(), h.email.recover()]);
    assert.equal(h.jobs.size, 1);
    assert.equal(h.calls.length, 0);
    await h.email.process([...h.jobs.values()][0]);
    assert.equal(h.records[0].status, 'accepted');
});

test('recovery ignores active/delayed/waiting jobs and unexpired leases', async () => {
    for (const state of ['active', 'delayed', 'waiting']) {
        const h = harness();
        const job = await h.enqueue();
        job.state = state;
        h.records[0].attempts = 1;
        h.records[0].status = 'sending';
        await h.email.recover();
        assert.equal(h.records[0].status, 'sending');
        assert.equal(h.records[0].attempts, 1);
        assert.equal(h.calls.length, 0);
    }
    const h = harness();
    await h.enqueue();
    h.jobs.clear();
    h.records[0].leaseUntil = new Date('2026-10-01T10:02:00Z');
    await h.email.recover();
    assert.equal(h.jobs.size, 0);
});

test('lost Redis jobs preserve remaining budget and delay; exhausted jobs never reset', async () => {
    const h = harness();
    const job = await h.enqueue();
    h.state.providerError = new DeliveryError('temporary', { retryable: true, retryAfterMs: 60000 });
    await assert.rejects(h.email.process(job));
    h.jobs.clear();
    await h.email.recover();
    const repaired = [...h.jobs.values()][0];
    assert.equal(repaired.opts.attempts, 2);
    assert.equal(repaired.opts.delay, 60000);
    h.records[0].attempts = 3;
    h.jobs.clear();
    h.advance(60000);
    await h.email.recover();
    assert.equal(h.jobs.size, 0);
    assert.equal(h.records[0].status, 'failed');
    assert.equal(h.records[0].attempts, 3);
});

test('abandoned Resend send replays only within idempotency window; SMTP ambiguity stops', async () => {
    for (const variant of ['resend-safe', 'resend-expired', 'smtp']) {
        const h = harness();
        await h.enqueue();
        const log = h.records[0];
        Object.assign(log, { status: 'sending', attempts: 1, acceptanceUncertain: true,
            firstAttemptAt: new Date('2026-10-01T10:00:00Z') });
        h.jobs.clear();
        if (variant === 'smtp') log.provider = 'smtp';
        if (variant === 'resend-expired') h.advance(86400001);
        await h.email.recover();
        if (variant === 'resend-safe') {
            assert.equal(h.jobs.size, 1);
            await h.email.process([...h.jobs.values()][0]);
            assert.equal(log.status, 'accepted');
        } else {
            assert.equal(h.jobs.size, 0);
            assert.equal(h.calls.length, 0);
            assert.equal(log.needsReview, true);
            assert.equal(log.status, variant === 'smtp' ? 'failed' : 'expired');
        }
    }
});

test('provider acceptance followed by Mongo failure is reconciled from receipt without resending', async () => {
    const h = harness();
    const job = await h.enqueue();
    h.state.failStatus = 'accepted';
    await assert.rejects(h.email.process(job), /email_tracking_unavailable/);
    assert.equal(job.data.receipt.providerMessageId, 'provider-123');
    assert.equal(h.records[0].status, 'sending');
    // Even an exhausted BullMQ job and an expired idempotency window can apply a receipt.
    job.state = 'failed';
    h.records[0].attempts = 3;
    h.advance(86400001);
    await h.email.recover();
    assert.equal(h.records[0].status, 'accepted');
    assert.equal(h.records[0].providerMessageId, 'provider-123');
    assert.equal(h.calls.length, 1);
});

test('permanent failure followed by DB failure is replayed as an outcome, not another send', async () => {
    const h = harness();
    const job = await h.enqueue();
    h.state.providerError = new DeliveryError('invalid_credentials');
    h.state.failStatus = 'failed';
    await assert.rejects(h.email.process(job), /email_tracking_unavailable/);
    await h.email.process(job);
    assert.equal(h.records[0].status, 'failed');
    assert.equal(h.calls.length, 1);
});

test('Retry-After survives a failed Mongo retry update and delays the next provider call', async () => {
    const h = harness();
    const job = await h.enqueue();
    h.state.providerError = new DeliveryError('rate_limited', { retryable: true, retryAfterMs: 60000 });
    h.state.failStatus = 'retrying';
    await assert.rejects(h.email.process(job), (error) => error.code === 'email_tracking_unavailable' && error.retryAfterMs === 60000);
    assert.equal(h.records[0].status, 'sending');
    await assert.rejects(h.email.process(job), DelayedError);
    assert.equal(h.records[0].status, 'retrying');
    assert.equal(h.calls.length, 1);
    h.advance(60000);
    h.state.providerError = null;
    await h.email.process(job);
    assert.equal(h.records[0].status, 'accepted');
    assert.equal(h.calls.length, 2);
});

test('third transient failure becomes terminal; failed queue jobs are not automatically retried', async () => {
    const h = harness();
    const job = await h.enqueue();
    h.state.providerError = new DeliveryError('temporary', { retryable: true });
    for (let index = 0; index < 3; index++) {
        await assert.rejects(h.email.process(job), index === 2 ? UnrecoverableError : DeliveryError);
        job.attemptsMade++;
        h.advance(60000);
    }
    assert.equal(h.records[0].attempts, 3);
    assert.equal(h.records[0].status, 'failed');
    await h.email.recover();
    assert.equal(h.calls.length, 3);

    const second = harness();
    const failedJob = await second.enqueue();
    failedJob.state = 'failed';
    await second.email.recover();
    assert.equal(second.records[0].status, 'failed');
    assert.equal(second.records[0].failure.code, 'email_queue_failed');
    assert.equal(second.calls.length, 0);
});

test('recovery is bounded and cleans expired encrypted payloads even on delayed jobs', async () => {
    const h = harness();
    h.settings.batchSize = 2;
    h.state.failAdd = true;
    for (let i = 0; i < 5; i++) await h.enqueue('welcome', {}, { dedupeKey: 'event-' + i });
    h.state.failAdd = false;
    await h.email.recover(1000);
    assert.equal(h.jobs.size, 2);
    h.advance(86400001);
    await h.email.recover();
    assert.ok(h.records.filter((r) => r.payload).length < 5);
});

test('model preserves collection and defines unique dedupe, TTL and hidden payload', () => {
    assert.equal(EmailLog.modelName, 'emailLog');
    const indexes = EmailLog.schema.indexes();
    assert.ok(indexes.some(([keys, opts]) => keys.dedupeKey === 1 && opts.unique && opts.partialFilterExpression));
    assert.ok(indexes.some(([keys, opts]) => keys.purgeAt === 1 && opts.expireAfterSeconds === 0));
    assert.equal(EmailLog.schema.path('payload').options.select, false);
    assert.equal(new EmailLog({ payload: 'secret' }).toJSON().payload, undefined);
});

test('official SDK adapter handles success, returned error, thrown timeout and missing config', async () => {
    const responses = [];
    const sent = [];
    let smtpCalls = 0;
    const { EmailService } = load('src/services/email.service.js', {
        resend: { Resend: class {
            constructor(key, options) {
                assert.equal(options.baseUrl, 'https://api.resend.com');
                this.emails = { send: async (...args) => {
                    sent.push(args);
                    const response = responses.shift();
                    if (response instanceof Error) throw response;
                    return response;
                } };
            }
        } },
        nodemailer: { createTransport() { smtpCalls++; throw new Error('must not fail over'); } },
    });
    const adapter = new EmailService();
    const log = { provider: 'resend', dedupeKey: 'fixed-key' };
    const request = { from: 'hello@example.test', to: ['user@example.test'], subject: 'test', text: 'body' };
    responses.push({ data: { id: 'message-1' }, error: null });
    assert.deepEqual(await adapter.deliver(log, request), { providerMessageId: 'message-1' });
    assert.equal(sent[0][1].idempotencyKey, 'fixed-key');
    assert.ok(sent[0][1].signal instanceof AbortSignal);
    responses.push({ data: null, error: { name: 'rate_limit_exceeded', statusCode: 429 }, headers: { 'retry-after': '12' } });
    await assert.rejects(adapter.deliver(log, request), (e) => e.retryable && e.retryAfterMs === 12000);
    responses.push(Object.assign(new Error('SECRET'), { code: 'ETIMEDOUT' }));
    await assert.rejects(adapter.deliver(log, request), (e) => e.retryable && e.ambiguous && !e.message.includes('SECRET'));
    responses.push({ error: { statusCode: 403, message: 'domain not verified' } });
    await assert.rejects(adapter.deliver(log, request), (e) => !e.retryable);
    const saved = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;
    try { await assert.rejects(adapter.deliver(log, request), /resend_configuration_missing/); }
    finally { process.env.RESEND_API_KEY = saved; }
    assert.equal(smtpCalls, 0);
});

test('classification honors retry dates, idempotency conflicts and conservative SMTP uncertainty', () => {
    assert.equal(retryAfter({ 'retry-after': 'Thu, 01 Oct 2026 10:01:00 GMT' }, Date.parse('2026-10-01T10:00:00Z')), 60000);
    assert.equal(classify({ name: 'daily_quota_exceeded', statusCode: 429 }, 'resend').retryable, false);
    assert.equal(classify(new Error('SECRET network failure'), 'resend').retryable, true);
    assert.equal(classify({ name: 'concurrent_idempotent_requests', statusCode: 409 }, 'resend').retryable, true);
    assert.equal(classify({ name: 'invalid_idempotent_request', statusCode: 409 }, 'resend').retryable, false);
    assert.equal(classify({ statusCode: 503 }, 'resend').retryable, true);
    assert.equal(classify({ name: 'application_error', statusCode: null }, 'resend').ambiguous, true);
    assert.equal(classify({ responseCode: 450 }, 'smtp').retryable, true);
    assert.equal(classify({ responseCode: 550 }, 'smtp').retryable, false);
    assert.equal(classify({ code: 'ETIMEDOUT' }, 'smtp').retryable, false);
    assert.equal(classify({ code: 'ETIMEDOUT' }, 'smtp').ambiguous, true);
    assert.equal(classify({ code: 'ECONNREFUSED' }, 'smtp').retryable, true);
});

test('credential checks reject consumed/superseded OTP and reset tokens', async () => {
    let saved = { credentialId: 'new', expiresAt: '2026-10-01T11:00:00Z' };
    let user = { passwordResetToken: 'new-hash', passwordResetExpires: new Date('2026-10-01T11:00:00Z') };
    const credentials = load('src/services/email-credential.service.js', {
        '../cache/redis_connect': { async get() { return saved && JSON.stringify(saved); } },
        '../models/User.model': { findById() { return query(() => user); } },
    });
    const now = new Date('2026-10-01T10:00:00Z');
    assert.equal(await credentials.isCurrent({ kind: 'otp', id: 'old', purpose: 'email_verification' }, 'user@example.test', now), false);
    assert.equal(await credentials.isCurrent({ kind: 'otp', id: 'new', purpose: 'email_verification' }, 'user@example.test', now), true);
    saved = null;
    assert.equal(await credentials.isCurrent({ kind: 'otp', id: 'new', purpose: 'email_verification' }, 'user@example.test', now), false);
    assert.equal(await credentials.isCurrent({ kind: 'passwordReset', userId: '1', tokenHash: 'old-hash' }, '', now), false);
    assert.equal(await credentials.isCurrent({ kind: 'passwordReset', userId: '1', tokenHash: 'new-hash' }, '', now), true);
    user = null;
    assert.equal(await credentials.isCurrent({ kind: 'passwordReset', userId: '1', tokenHash: 'new-hash' }, '', now), false);
});

test('worker uses shared queue, custom backoff, propagates failures and rejects legacy untracked jobs', async () => {
    let recovered = 0;
    const worker = load('src/worker/email.worker.js', {
        bullmq: { UnrecoverableError, Worker: class { constructor(name, processor, options) { Object.assign(this, { name, processor, options }); } on() {} } },
        '../jobs/email.job': { async process() { throw new DeliveryError('temporary', { retryable: true }); }, async recover() { recovered++; } },
        '../utils/logger': logger,
    });
    assert.equal(worker.name, 'emailQueue');
    assert.equal(worker.options.autorun, false);
    assert.equal(worker.options.settings.backoffStrategy, backoff);
    await assert.rejects(worker.processor({ name: 'deliverEmail' }), DeliveryError);
    await assert.rejects(worker.processor({ name: 'loginAlert' }), UnrecoverableError);
    await worker.processor({ name: 'recoverEmails' });
    assert.equal(recovered, 1);
});

test('scheduler upserts a stable recurring recovery job', async () => {
    const calls = [];
    const register = load('src/jobs/email.scheduler.js', {
        '../queue/email.queue': { emailQueue: { async upsertJobScheduler(...args) { calls.push(args); } } },
    });
    await register();
    await register();
    assert.equal(calls[0][0], 'email-recovery');
    assert.equal(calls[0][2].name, 'recoverEmails');
    assert.equal(calls[0][2].opts.attempts, 1);
    assert.deepEqual(calls[0], calls[1]);
});


test('only one concurrent processor crosses the provider boundary', async () => {
    const h = harness();
    const job = await h.enqueue();
    let releaseProvider;
    let signalStarted;
    const started = new Promise((resolve) => { signalStarted = resolve; });
    h.email.service.deliver = async () => {
        signalStarted();
        await new Promise((resolve) => { releaseProvider = resolve; });
        return { providerMessageId: 'only-once' };
    };
    const active = h.email.process(job);
    await started;
    await assert.rejects(h.email.process(job), DelayedError);
    assert.equal(h.records[0].attempts, 1);
    releaseProvider();
    await active;
    assert.equal(h.records[0].status, 'accepted');
});

test('loss of both outcome writes replays Resend with original identity but never ambiguous SMTP', async () => {
    for (const provider of ['resend', 'smtp']) {
        const h = harness();
        const job = await h.enqueue();
        h.records[0].provider = provider;
        job.updateData = async () => { throw new Error('Redis unavailable'); };
        h.state.failStatus = 'accepted';
        await assert.rejects(h.email.process(job), /email_tracking_unavailable/);
        assert.equal(h.records[0].acceptanceUncertain, true);
        if (provider === 'smtp') {
            await assert.rejects(h.email.process(job), /smtp_acceptance_unknown/);
            assert.equal(h.calls.length, 1);
            assert.equal(h.records[0].needsReview, true);
        } else {
            await h.email.process(job);
            assert.equal(h.calls.length, 2);
            assert.deepEqual(h.calls[0].request, h.calls[1].request);
            assert.equal(h.calls[0].log.dedupeKey, h.calls[1].log.dedupeKey);
            assert.equal(h.records[0].status, 'accepted');
        }
    }
});

test('SMTP remains available, uses fixed sender/Message-ID, and disables internal requeues', async () => {
    const saved = Object.fromEntries(['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'].map((key) => [key, process.env[key]]));
    Object.assign(process.env, { SMTP_HOST: 'smtp.example.test', SMTP_USER: 'test-user', SMTP_PASS: 'test-password' });
    let options;
    let mail;
    const { EmailService } = load('src/services/email.service.js', {
        resend: { Resend: class { constructor() { throw new Error('must not use Resend'); } } },
        nodemailer: { createTransport(value) {
            options = value;
            return { async sendMail(request) { mail = request; return { messageId: 'smtp-id', accepted: ['user@example.test'] }; } };
        } },
    });
    try {
        const adapter = new EmailService();
        const result = await adapter.deliver({ provider: 'smtp', dedupeKey: 'stable', createdAt: new Date() },
            { from: 'sender@example.test', to: ['user@example.test'], text: 'body', subject: 'test' });
        assert.equal(result.providerMessageId, 'smtp-id');
        assert.equal(options.maxRequeues, 0);
        assert.equal(mail.messageId, '<stable@vtunova.email>');
        assert.equal(mail.from, 'sender@example.test');
    } finally {
        for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) delete process.env[key]; else process.env[key] = value;
        }
    }
});

test('purchase event aliases and duplicate OTP events reuse the same persistent identity', async () => {
    const h = harness();
    const bus = load('src/events/eventsBus.js', { '../utils/logger': logger });
    const register = load('src/listeners/email.listener.js', {
        '../events/eventsBus.js': bus, '../utils/logger': logger,
        '../services/email.service': { send: (...args) => h.email.enqueue(...args) },
    });
    register();
    register();
    const EVENTS = require('../src/events/events');
    const user = { _id: 'user-1', email: 'user@example.test', firstName: 'Ada', wallet: { balance: 5000 } };
    const transaction = { _id: 'transaction-1', amount: 500, requestId: 'reference-1' };
    await bus.emitSafe(EVENTS.AIRTIME_PURCHASE, { user, transaction, status: 'success' }, { throwOnError: true });
    await bus.emitSafe(EVENTS.TRANSACTION_SUCCESSFUL, { user, transaction }, { throwOnError: true });
    assert.equal(h.records.length, 1);
    assert.equal(h.jobs.size, 1);
    const otp = { email: user.email, otp: '123456', expiresAt: '2026-10-01T10:05:00Z',
        credential: { kind: 'otp', id: 'credential-1', purpose: 'email_verification' } };
    await bus.emitSafe(EVENTS.USER_EMAIL_VERIFICATION_REQUESTED, { ...otp }, { throwOnError: true });
    await bus.emitSafe(EVENTS.USER_EMAIL_VERIFICATION_REQUESTED, { ...otp }, { throwOnError: true });
    assert.equal(h.records.length, 2);
    assert.equal(h.jobs.size, 2);
});

test('OTP producer persists identity/expiry and waits for listener persistence failures', async () => {
    let stored;
    let event;
    let fail = false;
    const service = load('src/services/otp.service.js', {
        '../cache/redis_connect': {},
        '../cache/redis_cache': { async set(value) { stored = value; } },
        '../events/eventsBus': { async emitSafe(name, payload, opts) {
            event = { name, payload, opts };
            assert.equal(stored.credentialId, payload.credential.id);
            if (fail) throw new Error('event_listener_failed');
        } },
        '../utils/logger': logger,
    });
    await service.createEmailVerificationOtp('user@example.test', 'Ada');
    assert.equal(event.payload.expiresAt, stored.expiresAt);
    assert.equal(event.opts.throwOnError, true);
    assert.equal(event.payload.credential.purpose, 'email_verification');
    const firstId = stored.credentialId;
    fail = true;
    await assert.rejects(service.createPasswordResetOtp({ email: 'user@example.test' }), /event_listener_failed/);
    assert.notEqual(firstId, stored.credentialId);
    assert.equal(event.payload.credential.purpose, 'password_reset');
});

test('password-reset template supports OTP and URL credentials', () => {
    const templates = require('../src/templates');
    const otp = templates.render('passwordReset', { otp: '123456', expiresInMinutes: 5 });
    assert.match(otp.text, /123456/);
    assert.doesNotMatch(otp.html, /href="undefined"/);
    assert.match(templates.render('passwordReset', { resetUrl: 'https://example.test/reset/credential' }).text,
        /https:\/\/example.test\/reset\/credential/);
});

test('queue retains failed jobs with bounded count/age and three attempts starting at ten seconds', () => {
    const { emailQueue } = load('src/queue/email.queue.js', {
        bullmq: { Queue: class { constructor(name, options) { this.options = options; } on() {} } },
        '../utils/logger': logger,
    });
    assert.equal(emailQueue.options.defaultJobOptions.attempts, 3);
    assert.equal(emailQueue.options.defaultJobOptions.backoff.delay, 10000);
    assert.ok(emailQueue.options.defaultJobOptions.removeOnFail.age > 0);
    assert.ok(emailQueue.options.defaultJobOptions.removeOnFail.count > 0);
});

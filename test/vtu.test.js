const test = require('node:test');
const assert = require('node:assert/strict');
const { load, makeService, query, logger } = require('../test-support/vtu');
const mongoose = require('mongoose');
const Transaction = require('../src/models/Transaction.model');
const Notification = require('../src/models/Notification.model');
const EVENTS = require('../src/events/events');
const formatter = require('../src/templates/notificationFormatter');
const templates = require('../src/templates');

const user = { _id: new mongoose.Types.ObjectId(), email: 'customer@example.com',
    firstName: 'Ada', wallet: { balance: 5000 } };

function purchase(overrides = {}) {
    return {
        _id: new mongoose.Types.ObjectId(), user: user._id, flowVersion: 2,
        provider: 'vtpass', requestId: '202609261230abc123',
        requestFingerprint: 'a'.repeat(64), transactionReference: '202609261230abc123',
        type: 'airtime', status: 'pending', walletState: 'reserved',
        amount: 500, phone: '08012345678', serviceID: 'mtn', ...overrides
    };
}

test('schema preserves the full VTU purchase and reconciliation state', async () => {
    const fields = purchase({ type: 'electricity', serviceID: 'ikeja-electric',
        variation_code: 'prepaid', billersCode: '12345678901', paymentCode: '12345',
        submittedAt: new Date(), settledAt: new Date(), paidAt: new Date(),
        providerCode: '000', providerStatus: 'delivered', providerReference: 'provider-123',
        purchasedCode: '1234-5678-9012', lastProviderError: 'ETIMEDOUT',
        nextCheckAt: new Date(), lastCheckedAt: new Date(), reviewAfter: new Date(),
        needsReview: true, checkAttempts: 2, checkLeaseToken: 'lease', checkLeaseUntil: new Date() });
    const document = new Transaction(fields);
    await document.validate();
    const persisted = document.toObject();
    for (const [key, value] of Object.entries(fields)) assert.deepEqual(persisted[key], value, key);
});

test('VTU records require purchase identity and reject unsupported amounts and states', () => {
    const invalid = new Transaction({ flowVersion: 2, amount: 10.5, status: 'complete', walletState: 'paid' });
    const errors = invalid.validateSync().errors;
    for (const key of ['user', 'requestId', 'requestFingerprint', 'provider', 'type', 'phone',
        'amount', 'status', 'walletState']) assert.ok(errors[key], key);
});

test('legacy wallet funding stays valid and pending records have no paidAt default', async () => {
    const legacy = new Transaction({ user: user._id, amount: 100.5, email: user.email });
    await legacy.validate();
    assert.equal(legacy.flowVersion, 1);
    assert.equal(legacy.walletState, undefined);
    assert.equal(legacy.paidAt, undefined);
    assert.equal(new Transaction(purchase()).paidAt, undefined);
});

test('idempotency index is unique per provider and excludes unreferenced legacy records', () => {
    const indexes = Transaction.schema.indexes();
    const [keys, options] = indexes.find(([, options]) => options.unique);
    assert.deepEqual(keys, { provider: 1, requestId: 1 });
    assert.deepEqual(options.partialFilterExpression,
        { provider: { $type: 'string' }, requestId: { $type: 'string' } });
    assert.ok(indexes.some(([keys]) => keys.nextCheckAt && keys.walletState && keys.flowVersion));
});

test('version 3 reservation only holds funds and persists the order and receipt fields', async () => {
    const calls = [];
    const session = { async withTransaction(run) { await run(); }, async endSession() {} };
    const db = { async startSession() { calls.push('session'); return session; } };
    const service = makeService({ transaction: {
        db, async init() { calls.push('indexes'); },
        findOne() { return { async session() { return null; } }; },
        async create([data]) { const document = new Transaction(data); await document.validate(); return [document]; }
    }, users: { db, schema: { path: () => true },
      findById() { return query(() => ({ wallet: { balance: 5000, reserved: 100, walletStatus: 'active' } })); },
      async findOneAndUpdate(filter, update) {
        assert.deepEqual(update.$inc, { 'wallet.reserved': 500 });
        assert.equal(filter.$expr.$gte[1], 500);
        return user;
    } } });
    const { transaction, created } = await service.reserve(purchase({
        type: 'electricity', billersCode: '12345678901', variation_code: 'prepaid', serviceID: 'ikeja-electric'
    }));
    assert.equal(created, true);
    assert.deepEqual(calls, ['session']);
    assert.equal(transaction.recipient, '12345678901');
    assert.equal(transaction.product_name, 'Electricity Bill');
    assert.equal(transaction.flowVersion, 3);
    assert.ok(transaction.nextCheckAt);
    assert.ok(transaction.reviewAfter);
});

test('a retried purchase only reads the original transaction', async () => {
    const service = makeService();
    const input = { requestId: '202609261230abc123', amount: 500, phone: '08012345678', serviceID: 'mtn' };
    const order = service.normalize(input, { user }, 'vtpass', 'airtime');
    const existing = purchase(order);
    const retryService = makeService({ transaction: { async findOne() { return existing; } } });
    retryService.preparePurchase = () => assert.fail('retry must not contact the provider');
    const result = await retryService.purchase(input, { user }, 'vtpass', 'airtime');
    assert.equal(result.requestId, existing.requestId);
    await assert.rejects(retryService.purchase({ ...input, amount: 600 }, { user }, 'vtpass', 'airtime'),
        { statusCode: 409 });
});

for (const [status, body] of [['success', { code: '000', content: { transactions: { status: 'delivered' } } }],
    ['failed', { code: '016' }]]) {
    test(`${status} settlement updates the wallet and emits events only once on replay`, async () => {
        let stored = purchase();
        let refunded = 0;
        let debitWrites = 0;
        let notifications = 0;
        const session = { async withTransaction(run) { await run(); }, async endSession() {} };
        const service = makeService({ transaction: {
            db: { async startSession() { return session; } },
            async findOneAndUpdate(filter, update) {
                assert.equal(filter.flowVersion, 2);
                if (stored.status !== filter.status || stored.walletState !== filter.walletState) return null;
                stored = { ...stored, ...update.$set };
                return stored;
            },
            findById() { return query(() => stored); }
        }, users: { findById() { return query(() => ({ wallet: { balance: 4500, reserved: 0 } })); },
          async updateOne(filter, update) {
            debitWrites++;
            refunded += update.$inc['wallet.balance'];
            return { matchedCount: 1 };
        } } });
        service.notify = async () => { notifications++; };
        const initial = { ...stored };
        await service.applyOutcome(initial, body, 'purchase');
        await service.applyOutcome(initial, body, 'requery');
        assert.equal(stored.status, status);
        assert.equal(stored.walletState, status === 'success' ? 'charged' : 'refunded');
        assert.equal(refunded, status === 'failed' ? 500 : 0);
        assert.equal(debitWrites, status === 'failed' ? 1 : 0);
        assert.equal(notifications, 1);
        assert.equal(stored.nextCheckAt, null);
        assert.equal(Boolean(stored.paidAt), status === 'success');
    });
}

test('unknown outcomes stay pending and do not trigger refunds or notifications', async () => {
    let stored = purchase({ nextCheckAt: new Date(Date.now() + 300000) });
    const service = makeService({ transaction: {
        async updateOne(filter, update) { stored = { ...stored, ...update.$set }; },
        async findById() { return stored; }
    } });
    service.notify = () => assert.fail('pending outcome must not notify');
    await service.applyOutcome(stored, { code: '999' }, 'requery');
    assert.equal(stored.status, 'pending');
    assert.equal(stored.walletState, 'reserved');
    assert.ok(stored.nextCheckAt);
});

test('notification failures cannot roll back settlement', async () => {
    const service = makeService({ users: { async findById() { throw new Error('unavailable'); } } });
    await assert.doesNotReject(service.notify(purchase({ status: 'success' })));
});

test('cache invalidation covers history, transaction, and wallet profile and tolerates outages', async () => {
    const keys = [];
    const service = makeService({ cache: { async invalidate(key) { keys.push(key); throw new Error('offline'); } } });
    const transaction = purchase();
    await service.invalidatePurchaseCache(transaction);
    assert.deepEqual(keys, [`user:${user._id}:transactions`, `user:${transaction._id}:transaction`,
        `user:${user._id}:profile`]);
});

for (const type of ['airtime', 'data', 'electricity', 'cable']) {
    for (const status of ['pending', 'success', 'failed']) {
        test(`${type} ${status} reaches email and notification listeners with consistent details`, async () => {
            const jobs = [];
            const emails = [];
            const emailJobs = [];
            const bus = load('src/events/eventsBus.js', { '../utils/logger': logger });
            const safe = load('src/utils/safe.js', { './logger': logger });
            load('src/listeners/notifications.listener.js', {
                '../events/eventsBus.js': bus, '../utils/safe': safe, '../utils/logger.js': logger,
                '../queue/notifications.queue': { async add(...args) { jobs.push(args); } }
            })();
            load('src/listeners/email.listener.js', {
                '../events/eventsBus.js': bus, '../utils/logger': logger,
                '../services/email.service': { async send(...args) { emails.push(args); } },
                '../queue/email.queue': { emailQueue: { async add(...args) { emailJobs.push(args); } } }
            })();
            const Worker = class {
                constructor(name, processor) { this.processor = processor; }
                on() {}
            };
            const emailWorker = load('src/worker/email.worker.js', {
                bullmq: { Worker }, dotenv: { config() {} }, '../utils/logger': logger,
                '../models/User.model': { findById() { return query(() => user); } },
                '../services/email.service': { async send(...args) { emails.push(args); } },
            });
            const service = makeService({ users: { async findById() { return user; } }, events: bus });
            const transaction = purchase({ type, status, walletState: status === 'success' ? 'charged' : 'refunded',
                billersCode: type === 'electricity' ? '12345678901' : undefined,
                purchasedCode: type === 'electricity' && status === 'success' ? '1234-5678-9012' : undefined });
            await service.notify(transaction);
            for (const [name, data] of emailJobs) await emailWorker.processor({ name, data });
            assert.equal(jobs.length, 1);
            assert.equal(emails.length, status === 'pending' ? 0 : 1);
            const [, notification, options] = jobs[0];
            assert.equal(notification.category, type);
            assert.equal(notification.status, status);
            assert.equal(notification.amount, 500);
            assert.equal(options.jobId, `${transaction._id}-${status}`);
            assert.match(notification.message, status === 'pending' ? /being processed/ :
                status === 'success' ? /has been completed/ : /returned to your VtuNova wallet/);
            const persisted = new Notification(notification);
            await persisted.validate();
            assert.equal(persisted.status, status);
            if (status === 'pending') {
                assert.match(notification.title, /Processing/);
                assert.doesNotMatch(notification.title, /Successful/);
                return;
            }
            const [template, address, data, meta] = emails[0];
            assert.equal(template, status === 'success' ? 'transactionSuccessful' : 'transactionFailed');
            assert.equal(address, user.email);
            assert.equal(data.reference, transaction.requestId);
            assert.equal(meta.dedupeKey, options.jobId);
            if (status === 'success') {
                assert.equal(data.newBalance, 5000);
                assert.equal(data.recipient, transaction.billersCode || transaction.phone);
                assert.equal(data.purchasedCode, transaction.purchasedCode);
            }
        });
    }
}

test('pending purchase notification emits only the service event with pending status', async () => {
    const events = [];
    const service = makeService({ events: { emitSafe(...args) { events.push(args); } } });
    await service.notify(purchase());
    assert.equal(events.length, 1);
    assert.equal(events[0][0], EVENTS.AIRTIME_PURCHASE);
    assert.equal(events[0][1].status, 'pending');
});

test('notification listener errors are logged without a secondary ReferenceError', async () => {
    const errors = [];
    const { safe } = load('src/utils/safe.js', { './logger': { error(...args) { errors.push(args); } } });
    await safe('purchase', async () => { throw new Error('queue unavailable'); })({});
    assert.match(errors[0][0], /queue unavailable/);
});

test('legacy notifications without a status do not claim the purchase is pending', () => {
    const notification = formatter.formatNotification({ type: 'transaction', category: 'airtime' });
    assert.equal(notification.title, 'Airtime Purchase');
    assert.equal(notification.message, 'Your transaction has been updated.');
});

test('existing branded templates show electricity codes and confirmed refunds', () => {
    const success = templates.render('transactionSuccessful', { service: 'Electricity Bill',
        amount: 500, purchasedCode: '<1234&5678>', reference: 'request-1' });
    assert.match(success.html, /Purchased Code/);
    assert.match(success.html, /&lt;1234&amp;5678&gt;/);
    assert.match(success.text, /<1234&5678>/);
    const failed = templates.render('transactionFailed', { amount: 500, walletState: 'refunded' });
    assert.match(failed.html, /returned to your VtuNova wallet/);
    assert.match(failed.text, /returned to your VtuNova wallet/);
    assert.doesNotMatch(failed.html, /allow some time/);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { harness, purchase, makeService, config, load, logger } = require('../test-support/vtu');
const Transaction = require('../src/models/Transaction.model');
const Notification = require('../src/models/Notification.model');

const success = { code: '000', content: { transactions: { status: 'delivered' } } };
const failed = { code: '016' };

for (const flowVersion of [2, 3]) {
    for (const [status, body] of [['success', success], ['failed', failed]]) {
        test(`background ${status} settles version ${flowVersion} exactly once on duplicate sweeps`, async () => {
            const record = purchase({ flowVersion });
            const { service, state } = harness([record]);
            if (flowVersion === 2) state.wallet = { balance: 4500, reserved: 0 };
            let queries = 0;
            service.queryProvider = async () => { queries++; return body; };
            await service.reconcilePendingBatch();
            await service.reconcilePendingBatch();
            await service.applyOutcome(record, body, 'requery');
            assert.equal(record.status, status);
            assert.equal(record.walletState, status === 'success' ? 'charged' : flowVersion === 3 ? 'released' : 'refunded');
            assert.deepEqual(state.wallet, { balance: status === 'success' ? 4500 : 5000, reserved: 0 });
            assert.equal(state.writes, flowVersion === 2 && status === 'success' ? 0 : 1);
            assert.equal(queries, 1);
            assert.equal(state.events.length, 1);
            assert.equal(record.nextCheckAt, null);
            assert.equal(record.checkLeaseToken, undefined);
        });
    }
}

test('version 3 schema requires identity and accepts released holds', async () => {
    await assert.rejects(new Transaction({ flowVersion: 3 }).validate(), /requestId/);
    await new Transaction(purchase({ status: 'failed', walletState: 'released' })).validate();
});

test('new purchase emits pending after reservation and terminal status after settlement', async () => {
    const record = purchase();
    let committed = false;
    const sequence = [];
    const { service, transaction, state } = harness([record], { events: { emitSafe(event, payload) {
        assert.equal(committed, true);
        if (payload.status === 'success') assert.equal(state.wallet.balance, 4500);
        sequence.push(payload.status);
    } } });
    transaction.findOne = async () => null;
    service.preparePurchase = async () => {};
    service.reserve = async () => { committed = true; return { transaction: record, created: true }; };
    service.submit = async () => { sequence.push('submit'); return success; };
    await service.purchase(record, { user: { _id: record.user } }, 'vtpass', 'airtime');
    assert.deepEqual(sequence, ['pending', 'submit', 'success']);
});

test('pending and status-check timeout preserve the total balance and hold', async () => {
    const record = purchase();
    const { service, state } = harness([record]);
    service.queryProvider = async () => ({ code: '099' });
    await service.reconcilePendingBatch();
    assert.deepEqual(state.wallet, { balance: 5000, reserved: 500 });
    assert.equal(state.events.length, 0);
    record.nextCheckAt = new Date(0);
    service.queryProvider = async () => { throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }); };
    const before = Date.now();
    await assert.rejects(service.reconcilePendingBatch(), { code: 'RECONCILIATION_CHECK_FAILED' });
    assert.equal(record.status, 'pending');
    assert.deepEqual(state.wallet, { balance: 5000, reserved: 500 });
    assert.equal(record.lastProviderError, 'ETIMEDOUT');
    assert.ok(record.nextCheckAt >= before + config.checkIntervalMs);
    assert.equal(record.checkLeaseToken, undefined);
});

test('review threshold flags once, keeps the hold and continues slower status checks', async () => {
    const record = purchase({ reviewAfter: new Date(0) });
    const { service, state } = harness([record]);
    let queries = 0;
    service.queryProvider = async () => { queries++; return { code: '099' }; };
    const before = Date.now();
    await service.reconcilePendingBatch();
    assert.equal(record.needsReview, true);
    assert.ok(record.nextCheckAt >= before + config.reviewIntervalMs);
    assert.deepEqual(state.wallet, { balance: 5000, reserved: 500 });
    // Recover review records stranded with null scheduling by the old cutoff.
    record.nextCheckAt = null;
    await service.reconcilePendingBatch();
    assert.equal(queries, 2);
    assert.equal(state.logs.filter((log) => log.message.includes('requires admin review')).length, 1);
    assert.equal(state.events.length, 0);
    record.nextCheckAt = new Date(0);
    service.queryProvider = async () => success;
    await service.reconcilePendingBatch();
    assert.equal(record.status, 'success');
    assert.equal(record.needsReview, false);
});

test('normal and review backlogs each receive capacity with bounded concurrency and batch size', async () => {
    const records = Array.from({ length: 20 }, (_, i) => purchase({ needsReview: i < 10 }));
    const { service } = harness(records);
    let active = 0;
    let maximum = 0;
    const checked = [];
    service.queryProvider = async (t) => {
        checked.push(t.needsReview);
        maximum = Math.max(maximum, ++active);
        await new Promise((resolve) => setImmediate(resolve));
        active--;
        return {};
    };
    assert.equal((await service.reconcilePendingBatch(6)).checked, 6);
    assert.equal(checked.filter(Boolean).length, 3);
    assert.equal(maximum, config.concurrency);
});

test('active leases are skipped and a restarted worker recovers expired leases', async () => {
    const record = purchase({ checkLeaseToken: 'crashed', checkLeaseUntil: new Date(Date.now() + 100000) });
    const { service } = harness([record]);
    service.queryProvider = async () => success;
    assert.equal((await service.reconcilePendingBatch()).checked, 0);
    record.checkLeaseUntil = new Date(0);
    assert.equal((await service.reconcilePendingBatch()).checked, 1);
    assert.equal(record.status, 'success');
});

for (const response of [success, {}, null]) {
    test(`stale worker cannot settle, release, or reschedule after lease replacement (${response?.code || 'pending/error'})`, async () => {
        const record = purchase();
        const { service, state } = harness([record]);
        const nextCheck = new Date(Date.now() + 9999999);
        service.queryProvider = async () => {
            record.checkLeaseToken = 'new-owner';
            record.checkLeaseUntil = new Date(Date.now() + config.leaseMs);
            record.nextCheckAt = nextCheck;
            if (!response) throw new Error('timeout');
            return response;
        };
        if (response) await service.reconcilePendingBatch();
        else await assert.rejects(service.reconcilePendingBatch());
        assert.equal(record.status, 'pending');
        assert.equal(record.checkLeaseToken, 'new-owner');
        assert.equal(record.nextCheckAt, nextCheck);
        assert.equal(record.lastCheckedAt, undefined);
        assert.equal(state.writes, 0);
    });
}

test('one bad purchase does not stop others, and infrastructure failures fail the sweep', async () => {
    const records = [purchase(), purchase()];
    const { service, transaction } = harness(records);
    service.queryProvider = async (t) => {
        if (t._id === records[0]._id) throw new Error('offline');
        return success;
    };
    await assert.rejects(service.reconcilePendingBatch());
    assert.equal(records[1].status, 'success');
    transaction.findOneAndUpdate = async () => { throw new Error('database offline'); };
    await assert.rejects(service.reconcilePendingBatch());
});

test('a lease that expires during the provider call cannot settle or change the schedule', async () => {
    const record = purchase();
    const { service, state } = harness([record]);
    const originalSchedule = record.nextCheckAt;
    service.queryProvider = async () => {
        record.checkLeaseUntil = new Date(0);
        return success;
    };
    await service.reconcilePendingBatch(2);
    assert.equal(record.status, 'pending');
    assert.equal(record.nextCheckAt, originalSchedule);
    assert.equal(state.writes, 0);
});

test('provider rate-limit Retry-After delays the next status check', async () => {
    const record = purchase();
    const { service } = harness([record]);
    service.queryProvider = async () => { throw Object.assign(new Error('rate limited'), {
        response: { status: 429, headers: { 'retry-after': '7200' } },
    }); };
    const before = Date.now();
    await assert.rejects(service.reconcilePendingBatch());
    assert.ok(record.nextCheckAt >= before + 7200000);
});

test('status queries use the original provider and request ID, never a purchase endpoint', async () => {
    const calls = [];
    const axios = async (options) => { calls.push(options); return { data: {} }; };
    axios.post = async (url, data) => { calls.push({ url, data }); return { data: {} }; };
    const service = makeService({ axios });
    service.vtpassHeaders = () => ({});
    service.quickteller_get_token = async () => 'test-token';
    await service.queryProvider(purchase());
    await service.queryProvider(purchase({ provider: 'quickteller', requestId: 'original123' }));
    assert.ok(calls[0].url.endsWith('/requery'));
    assert.equal(calls[0].data.request_id, '202609261230abc123');
    assert.equal(calls[1].method, 'GET');
    assert.equal(calls[1].url, '/Transactions');
    assert.equal(calls[1].params.requestRef, 'original123');
});

test('notification transition deduplication uses a persistent unique event ID', async () => {
    assert.ok(Notification.schema.indexes().some(([keys, options]) => keys.eventId && options.unique));
    let saved;
    let inserts = 0;
    const service = load('src/services/notification.service.js', {
        '../models/Notification.model': { async findOneAndUpdate(filter, update, options) {
            assert.equal(options.upsert, true);
            if (!saved) { saved = update.$setOnInsert; inserts++; }
            return saved;
        } },
        '../models/Transaction.model': { findOne() { return { async sort() { return null; } }; } },
        '../utils/logger': logger, '../cache/redis_cache': { async invalidate() {} },
        './transaction.service': {},
    });
    const data = { eventId: 'purchase-success', userId: purchase().user, type: 'transaction' };
    await service.createNotification({ notificationData: data, userId: data.userId });
    await service.createNotification({ notificationData: data, userId: data.userId });
    assert.equal(inserts, 1);
});

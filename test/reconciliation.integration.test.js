const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const mongoose = require('mongoose');
const { makeService, purchase, load, logger } = require('../test-support/vtu');

const success = { code: '000', content: { transactions: { status: 'delivered' } } };
const failed = { code: '016' };

// Only explicitly supplied test endpoints are used. Never load the application's .env here.
test('real MongoDB replica-set concurrency and rollback', {
    skip: !process.env.VTU_TEST_MONGODB_URI && 'Set VTU_TEST_MONGODB_URI to an isolated replica set',
}, async (t) => {
    const dbName = `vtunova_reconciliation_test_${randomBytes(8).toString('hex')}`;
    const connection = await mongoose.createConnection(process.env.VTU_TEST_MONGODB_URI, {
        dbName, autoIndex: false, serverSelectionTimeoutMS: 5000,
    }).asPromise();
    t.after(async () => {
        // The generated test database is the only database this suite drops.
        try { await connection.dropDatabase(); } finally { await connection.close(); }
    });
    const hello = await connection.db.admin().command({ hello: 1 });
    assert.ok(hello.setName || hello.msg === 'isdbgrid', 'A replica set or sharded cluster is required');
    const Transaction = connection.model('Transaction', require('../src/models/Transaction.model').schema.clone());
    const User = connection.model('User', require('../src/models/User.model').schema.clone());
    const Notification = connection.model('Notification', require('../src/models/Notification.model').schema.clone());
    await Promise.all([Transaction.createIndexes(), User.createIndexes(), Notification.createIndexes()]);

    async function fixture(flowVersion = 3) {
        const userId = new mongoose.Types.ObjectId();
        await User.collection.insertOne({ _id: userId, email: `${userId}@example.test`,
            wallet: { balance: flowVersion === 3 ? 5000 : 4500, reserved: flowVersion === 3 ? 500 : 0, walletStatus: 'active' } });
        const record = await Transaction.create(purchase({ user: userId, flowVersion,
            requestId: `202609261230${userId}` }));
        const events = [];
        const service = makeService({ transaction: Transaction, users: User,
            events: { emitSafe: (...args) => events.push(args) } });
        return { record, userId, service, events };
    }

    for (const flowVersion of [2, 3]) {
        for (const [status, body] of [['success', success], ['failed', failed]]) {
            await t.test(`version ${flowVersion} concurrent ${status} settlement commits once`, async () => {
                const { record, userId, service, events } = await fixture(flowVersion);
                await Promise.all(Array.from({ length: 6 }, () => service.applyOutcome(record, body, 'requery')));
                const wallet = (await User.findById(userId)).wallet;
                assert.equal(wallet.balance, status === 'success' ? 4500 : 5000);
                assert.equal(wallet.reserved, 0);
                assert.equal((await Transaction.findById(record._id)).status, status);
                assert.equal(events.length, 1);
            });
        }
    }

    await t.test('competing success and failure produce one consistent terminal outcome', async () => {
        const { record, userId, service, events } = await fixture();
        await Promise.all([service.applyOutcome(record, success, 'purchase'), service.applyOutcome(record, failed, 'requery')]);
        const final = await Transaction.findById(record._id);
        const user = await User.findById(userId);
        assert.equal(user.wallet.balance, final.status === 'success' ? 4500 : 5000);
        assert.equal(user.wallet.reserved, 0);
        assert.equal(events.length, 1);
    });

    await t.test('a failed terminal write rolls back the preceding wallet update', async () => {
        const { record, userId, service } = await fixture();
        const update = Transaction.findOneAndUpdate;
        Transaction.findOneAndUpdate = () => { throw new Error('injected terminal write failure'); };
        try { await assert.rejects(service.applyOutcome(record, success, 'requery')); }
        finally { Transaction.findOneAndUpdate = update; }
        const user = await User.findById(userId);
        assert.equal(user.wallet.balance, 5000);
        assert.equal(user.wallet.reserved, 500);
        assert.equal((await Transaction.findById(record._id)).status, 'pending');
        await service.applyOutcome(record, failed, 'requery');
    });

    await t.test('duplicate sweeps claim a due purchase only once', async () => {
        const { record, service } = await fixture();
        let checks = 0;
        service.queryProvider = async () => { checks++; return success; };
        await Promise.all([service.reconcilePendingBatch(), service.reconcilePendingBatch()]);
        assert.equal(checks, 1);
        assert.equal((await Transaction.findById(record._id)).status, 'success');
    });

    await t.test('expired and replaced leases protect both settlement and scheduling', async () => {
        const { record, userId, service } = await fixture();
        await Transaction.updateOne({ _id: record._id }, { $set: {
            checkLeaseToken: 'crashed', checkLeaseUntil: new Date(0),
        } });
        const nextCheckAt = new Date(Date.now() + 7200000);
        service.queryProvider = async (claimed) => {
            assert.notEqual(claimed.checkLeaseToken, 'crashed');
            await Transaction.updateOne({ _id: record._id }, { $set: {
                checkLeaseToken: 'new-owner', checkLeaseUntil: new Date(Date.now() + 180000), nextCheckAt,
            } });
            return success;
        };
        await service.reconcilePendingBatch();
        const final = await Transaction.findById(record._id);
        assert.equal(final.status, 'pending');
        assert.equal(final.checkLeaseToken, 'new-owner');
        assert.deepEqual(final.nextCheckAt, nextCheckAt);
        assert.equal((await User.findById(userId)).wallet.reserved, 500);
    });

    await t.test('concurrent notification jobs persist one transition after queue removal', async () => {
        const notificationService = load('src/services/notification.service.js', {
            '../models/Notification.model': Notification, '../models/Transaction.model': Transaction,
            '../utils/logger': logger, '../cache/redis_cache': { async invalidate() {} }, './transaction.service': {},
        });
        const data = { eventId: 'test-success', userId: new mongoose.Types.ObjectId(), status: 'success', type: 'transaction' };
        const persist = () => notificationService.createNotification({ notificationData: data, userId: data.userId });
        await Promise.all(Array.from({ length: 8 }, persist));
        await persist();
        assert.equal(await Notification.countDocuments({ eventId: data.eventId }), 1);
    });
});

test('real Redis scheduler identity, restart recovery and global concurrency', {
    skip: !process.env.VTU_TEST_REDIS_URL && 'Set VTU_TEST_REDIS_URL to isolated Redis', timeout: 20000,
}, async (t) => {
    const { Queue, Worker } = require('bullmq');
    const IORedis = require('ioredis');
    const redis = new IORedis(process.env.VTU_TEST_REDIS_URL, { maxRetriesPerRequest: null });
    const prefix = `vtunova-reconciliation-test-${randomBytes(8).toString('hex')}`;
    const queue = new Queue('sweep', { connection: redis, prefix,
        defaultJobOptions: { attempts: 1, removeOnComplete: { count: 3 }, removeOnFail: { count: 3 } } });
    const workers = [];
    t.after(async () => {
        await Promise.all(workers.map((worker) => worker.close()));
        await queue.obliterate({ force: true });
        await queue.close();
        await redis.quit();
    });
    const config = { schedulerId: 'pending-purchase-sweep', jobName: 'reconcilePendingPurchases', sweepIntervalMs: 1000 };
    const register = load('src/jobs/reconciliation.scheduler.js', {
        '../queue/reconciliation.queue': queue, '../config/reconciliation': config, '../utils/logger': logger,
    });
    await Promise.all([register(), register()]);
    assert.equal(await queue.getJobSchedulersCount(), 1);
    let active = 0;
    let maximum = 0;
    let processed = 0;
    const start = () => {
        const worker = new Worker('sweep', async () => {
            maximum = Math.max(maximum, ++active);
            await new Promise((resolve) => setTimeout(resolve, 1200));
            active--;
            processed++;
        }, { connection: redis, prefix, concurrency: 1 });
        workers.push(worker);
        return worker;
    };
    async function until(check) {
        const deadline = Date.now() + 12000;
        while (!await check()) {
            assert.ok(Date.now() < deadline, 'Timed out waiting for test jobs');
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
    }
    const first = start();
    const second = start();
    await until(() => processed >= 2);
    await Promise.all([first.close(), second.close()]);
    const beforeRestart = processed;
    await register();
    start();
    await until(() => processed > beforeRestart);
    assert.equal(maximum, 1);
    assert.equal(await queue.getJobSchedulersCount(), 1);
    const counts = await queue.getJobCounts('delayed', 'waiting', 'active', 'completed');
    assert.ok(counts.delayed + counts.waiting + counts.active <= 2);
    assert.ok(counts.completed <= 3);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { load, logger } = require('../test-support/vtu');

const config = { queueName: 'purchaseReconciliationQueue', schedulerId: 'pending-purchase-sweep',
    jobName: 'reconcilePendingPurchases', sweepIntervalMs: 60000, connection: {} };

test('scheduler upserts one stable identity and serializes sweeps across workers', async () => {
    const calls = [];
    const register = load('src/jobs/reconciliation.scheduler.js', {
        '../config/reconciliation': config, '../utils/logger': logger,
        '../queue/reconciliation.queue': {
            async setGlobalConcurrency(value) { calls.push(['concurrency', value]); },
            async upsertJobScheduler(...args) { calls.push(['scheduler', ...args]); },
        },
    });
    await register();
    await register();
    assert.deepEqual(calls[0], ['concurrency', 1]);
    assert.deepEqual(calls[1], ['scheduler', config.schedulerId, { every: 60000 },
        { name: config.jobName, data: {} }]);
    assert.deepEqual(calls.slice(0, 2), calls.slice(2));
});

test('queue retains bounded history and relies on future sweeps for recovery', () => {
    const queue = load('src/queue/reconciliation.queue.js', {
        '../config/reconciliation': config, '../utils/logger': logger,
        bullmq: { Queue: class { constructor(name, options) { this.options = options; } on() {} } },
    });
    assert.deepEqual(queue.options.defaultJobOptions, {
        attempts: 1, removeOnComplete: { count: 100 }, removeOnFail: { count: 100 },
    });
});

test('worker calls the reconciler and propagates sweep failures to BullMQ', async () => {
    let fail = false;
    const worker = load('src/worker/reconciliation.worker.js', {
        '../config/reconciliation': config, '../utils/logger': logger,
        '../services/vtu.service': { async reconcilePendingBatch() {
            if (fail) throw new Error('database unavailable');
            return { checked: 2, errors: 0 };
        } },
        bullmq: { Worker: class {
            constructor(name, processor, options) { Object.assign(this, { processor, options }); }
            on() {}
        } },
    });
    assert.equal(worker.options.autorun, false);
    assert.equal(worker.options.concurrency, 1);
    assert.deepEqual(await worker.processor({ name: config.jobName }), { checked: 2, errors: 0 });
    fail = true;
    await assert.rejects(worker.processor({ name: config.jobName }), /database unavailable/);
    await assert.rejects(worker.processor({ name: 'buyAirtime' }), /Unknown reconciliation job/);
});

test('entry point connects, registers listeners and scheduler, runs and drains in order', async () => {
    const calls = [];
    const closeable = (name) => ({ async close() { calls.push(`close-${name}`); } });
    const runtime = load('worker.js', {
        dotenv: { config() {} }, './src/utils/logger': logger,
        mongoose: {
            async connect() { calls.push('connect'); }, async disconnect() { calls.push('disconnect'); },
        },
        './src/listeners/email.listener': () => calls.push('email-listeners'),
        './src/listeners/notifications.listener': () => calls.push('notification-listeners'),
        './src/jobs/reconciliation.scheduler': async () => calls.push('scheduler'),
        './src/jobs/email.scheduler': async () => calls.push('email-scheduler'),
        './src/models/EmailLog.model': { async createIndexes() { calls.push('email-indexes'); } },
        './src/utils/email-payload': { validateKey() {} },
        './src/worker/reconciliation.worker': {
            ...closeable('reconciliation'), async waitUntilReady() {},
            run() { calls.push('run'); return new Promise(() => {}); },
        },
        './src/worker/notification.worker': closeable('notifications'),
        './src/worker/email.worker': { ...closeable('emails'), async waitUntilReady() {},
            run() { calls.push('email-run'); return new Promise(() => {}); } },
        './src/queue/reconciliation.queue': closeable('reconciliation-queue'),
        './src/queue/notifications.queue': closeable('notification-queue'),
        './src/queue/email.queue': { emailQueue: closeable('email-queue') },
        './src/cache/redis_connect': { isOpen: true, destroy() { calls.push('redis-close'); } },
        './src/services/email.service': { transporter: { close() { calls.push('smtp-close'); } } },
    });
    await runtime.startWorker();
    assert.deepEqual(calls, ['connect', 'email-indexes', 'email-listeners', 'notification-listeners', 'scheduler', 'email-scheduler', 'email-run', 'run']);
    await Promise.all([runtime.shutdown('SIGTERM'), runtime.shutdown('SIGINT')]);
    assert.equal(calls.filter((s) => s === 'close-reconciliation').length, 1);
    assert.ok(calls.indexOf('close-reconciliation') < calls.indexOf('close-notifications'));
    assert.ok(calls.indexOf('close-notifications') < calls.indexOf('close-notification-queue'));
    assert.equal(calls.at(-1), 'disconnect');
});

'use strict';

require('dotenv').config();

//--------------BOUNDED RECONCILIATION SETTINGS--------------//
function integer(name, fallback, min, max) {
    const value = Number(process.env[name] ?? fallback);
    if (!Number.isSafeInteger(value) || value < min || value > max) {
        throw new Error(`${name} must be an integer between ${min} and ${max}`);
    }
    return value;
}

module.exports = {
    queueName: 'purchaseReconciliationQueue',
    schedulerId: 'pending-purchase-sweep',
    jobName: 'reconcilePendingPurchases',
    sweepIntervalMs: integer('VTU_RECONCILE_SWEEP_MS', 60000, 1000, 3600000),
    checkIntervalMs: integer('VTU_RECONCILE_CHECK_MS', 300000, 60000, 86400000),
    reviewAfterMs: integer('VTU_RECONCILE_REVIEW_AFTER_MS', 86400000, 60000, 2592000000),
    reviewIntervalMs: integer('VTU_RECONCILE_REVIEW_MS', 3600000, 60000, 604800000),
    // Quickteller may need two 15s calls; MongoDB can retry settlement for 120s.
    leaseMs: integer('VTU_RECONCILE_LEASE_MS', 180000, 180000, 900000),
    batchSize: integer('VTU_RECONCILE_BATCH_SIZE', 50, 2, 200),
    concurrency: integer('VTU_RECONCILE_CONCURRENCY', 3, 1, 10),
    connection: {
        host: process.env.REDIS_HOST,
        port: Number(process.env.REDIS_PORT || 6379),
        password: process.env.REDIS_PASSWORD,
    },
};

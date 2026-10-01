'use strict';

require('dotenv').config();

//--------------BOUNDED EMAIL DELIVERY SETTINGS--------------//
function integer(name, fallback, min, max) {
    const value = Number(process.env[name] ?? fallback);
    if (!Number.isSafeInteger(value) || value < min || value > max) {
        throw new Error(`${name} must be an integer between ${min} and ${max}`);
    }
    return value;
}

module.exports = {
    queueName: 'emailQueue',
    maxAttempts: integer('EMAIL_MAX_ATTEMPTS', 3, 1, 10),
    backoffMs: integer('EMAIL_BACKOFF_MS', 10000, 1000, 3600000),
    timeoutMs: integer('EMAIL_TIMEOUT_MS', 30000, 1000, 60000),
    leaseMs: 120000,
    concurrency: integer('EMAIL_CONCURRENCY', 5, 1, 20),
    recoveryIntervalMs: integer('EMAIL_RECOVERY_INTERVAL_MS', 60000, 10000, 3600000),
    batchSize: integer('EMAIL_RECOVERY_BATCH_SIZE', 50, 1, 200),
    retentionDays: integer('EMAIL_LOG_RETENTION_DAYS', 180, 2, 365),
    payloadRetentionMs: integer('EMAIL_PAYLOAD_RETENTION_HOURS', 24, 1, 24) * 3600000,
    failedJobAge: integer('EMAIL_FAILED_JOB_RETENTION_DAYS', 7, 1, 30) * 86400,
    failedJobCount: integer('EMAIL_FAILED_JOB_RETENTION_COUNT', 1000, 1, 10000),
    // Five minutes of margin inside Resend's documented 24-hour window.
    idempotencyWindowMs: 24 * 3600000 - 300000,
    connection: {
        host: process.env.REDIS_HOST,
        port: Number(process.env.REDIS_PORT || 6379),
        password: process.env.REDIS_PASSWORD,
    },
};

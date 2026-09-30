'use strict';

const { Worker } = require('bullmq');
const service = require('../services/vtu.service');
const config = require('../config/reconciliation');
const logger = require('../utils/logger');

// Start only after MongoDB, listeners and the scheduler are ready.
const reconciliationWorker = new Worker(config.queueName, async (job) => {
    if (job.name !== config.jobName) throw new Error('Unknown reconciliation job');
    logger.info('Purchase reconciliation sweep started', { jobId: job.id });
    const result = await service.reconcilePendingBatch();
    logger.info('Purchase reconciliation sweep completed', { jobId: job.id, ...result });
    return result;
}, {
    connection: config.connection,
    concurrency: 1,
    autorun: false,
});

reconciliationWorker.on('failed', (job, err) => {
    logger.error('Purchase reconciliation sweep failed', {
        jobId: job?.id, errorName: err.name, code: err.code,
    });
});
reconciliationWorker.on('error', (err) => {
    logger.error('Purchase reconciliation worker error', { errorName: err.name, code: err.code });
});

module.exports = reconciliationWorker;

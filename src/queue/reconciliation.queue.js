'use strict';

const { Queue } = require('bullmq');
const config = require('../config/reconciliation');
const logger = require('../utils/logger');

const reconciliationQueue = new Queue(config.queueName, {
    connection: config.connection,
    defaultJobOptions: {
        // The next sweep recovers from MongoDB, so failed sweeps need no retries.
        attempts: 1,
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 100 },
    },
});

reconciliationQueue.on('error', (err) => {
    logger.error('Reconciliation queue error', { errorName: err.name, code: err.code });
});

module.exports = reconciliationQueue;

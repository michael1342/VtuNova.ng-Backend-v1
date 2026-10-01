'use strict';

const { Queue } = require('bullmq');
const config = require('../config/email');
const logger = require('../utils/logger');

//--------------SHARED EMAIL QUEUE / BOUNDED JOB HISTORY--------------//
const emailQueue = new Queue(config.queueName, {
    connection: config.connection,
    defaultJobOptions: {
        attempts: config.maxAttempts,
        backoff: { type: 'email', delay: config.backoffMs },
        removeOnComplete: { age: 86400, count: 1000 },
        removeOnFail: { age: config.failedJobAge, count: config.failedJobCount },
    },
});
emailQueue.on('error', () => logger.error('Email queue unavailable'));

module.exports = { emailQueue };

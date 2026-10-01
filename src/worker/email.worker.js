'use strict';

const { Worker, UnrecoverableError } = require('bullmq');
const jobs = require('../jobs/email.job');
const config = require('../config/email');
const { backoff, DeliveryError } = require('../utils/email-errors');
const logger = require('../utils/logger');

//--------------DELIVERY AND RECOVERY SHARE THE EXISTING EMAIL QUEUE--------------//
const emailWorker = new Worker(config.queueName, async (job, token) => {
    if (job.name === 'recoverEmails') {
        try { return await jobs.recover(); }
        catch { throw new DeliveryError('email_recovery_unavailable', { retryable: true }); }
    }
    if (job.name === 'deliverEmail') return jobs.process(job, token);
    // Old jobs contain no tracked immutable intent. Never send them untracked.
    throw new UnrecoverableError('email_legacy_job_requires_review');
}, {
    connection: config.connection, concurrency: config.concurrency, autorun: false,
    settings: { backoffStrategy: backoff },
});
emailWorker.on('completed', (job) => logger.info('Email job completed', { jobId: job.id }));
emailWorker.on('failed', (job) => logger.warn('Email job failed; inspect tracked outcome', { jobId: job?.id }));
emailWorker.on('error', () => logger.error('Email worker unavailable'));

module.exports = emailWorker;

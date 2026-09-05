const { Worker } = require('bullmq');
const notificationService = require('../services/notification.service');
const logger = require('../utils/logger');
console.log('notificationWorker.js loaded');

const notificationWorker = new Worker(
    'notificationQueue',
    async (job) => {
        logger.info(`Processing job: ${job.name}`);
        logger.info(`Job data: ${JSON.stringify(job.data)}`);
        if (job.name === 'createNotification') {
            logger.info(`Creating notification for transaction ${job.data.transactionId} and user ${job.data.userId}`);
            await notificationService.createNotification(job.data.transactionId, job.data.userId);
        }
    },
    {
        connection: {
            host: process.env.REDIS_HOST,
            port: process.env.REDIS_PORT,
        },
    }
);

notificationWorker.on('completed', (job) => {
    logger.info(`${job.id} Job completed`);
});

notificationWorker.on('failed', (job, error) => {
    logger.error(`${job?.id} Job  failed:`, error);
});

module.exports = notificationWorker;

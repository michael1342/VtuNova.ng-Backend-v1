const { Worker } = require('bullmq');
const notificationService = require('../services/notification.service');
const logger = require('../utils/logger');

require('dotenv').config();

console.log('notificationWorker.js loaded');

/* ============================================================
   PERSIST HELPER
============================================================ */

/**
 * Normalizes notification job data and persists it via NotificationService.
 * 
 * @param {Object} data - Notification job payload containing event details.
 * @param {string} [data.user] - User ID target for the notification.
 * @param {string} [data.userId] - Alternative user ID property.
 * @param {string} [data.transactionId] - Transaction ID associated with the event.
 * @returns {Promise<void>}
 */
async function persist(data) {
    const notificationData = {
        ...data
    };
    await notificationService.createNotification({
        notificationData,
        userId: data.user || data.userId || '',
        ip: data.ip,
        device: data.device
    });
}

/* ============================================================
   WORKER
============================================================ */

/**
 * BullMQ Worker processing background job tasks for the 'notificationQueue'.
 * Listens for queued notification requests and persists notification entries.
 */
const notificationWorker = new Worker(
    'notificationQueue',
    async (job) => {
        logger.info(`[notif-worker] Processing job: ${job.name} (id=${job.id})`);
        logger.info(`[notif-worker] Job data: ${JSON.stringify(job.data)}`);

        switch (job.name) {

            /* ── Generic pass-through (emitted directly by service layer) ── */
            case 'createRaw': {
                await persist(job.data);
                break;
            }

            /* ── VTU Services & Wallet Deposits ───────────────────────────── */
            case 'vtuPurchase':
            case 'airtimePurchase':
            case 'dataPurchase': {
                logger.info(`job proccessing for user ${job.data.userId || job.data.user}`);
                await persist({ ...job.data, type: job.data.type || 'vtu', transactionType: 'vtu-purchase', user: job.data.user || job.data.userId });
                break;
            }

            case 'depositSuccessful':
            case 'walletDeposit': {
                await persist({ ...job.data, type: 'deposit', transactionType: 'wallet-deposit', user: job.data.user || job.data.userId });
                break;
            }

            /* ── Standard notification creation (triggered by event listeners) ── */
            case 'createNotification': {
                logger.info(`[notif-worker] Creating notification for transaction ${job.data.transactionId || 'N/A'} and user ${job.data.userId || job.data.user}`);
                await persist(job.data);
                break;
            }

            case 'loginAlert': {
                logger.info(`[notif-worker] Processing login alert for user ${job.data.userId || job.data.user}`);
                await persist({ ...job.data, type: 'loginAlert', user: job.data.user || job.data.userId, ip: job.data.ip, device: job.data.device });
                break;
            }

            /* ── Default fallback for unknown job types ── */
            default: {
                logger.warn(`[notif-worker] Unhandled job name: ${job.name}. Falling back to default persistence.`);
                await persist(job.data);
                break;
            }
        }
    },
    {
        connection: {
            host: process.env.REDIS_HOST,
            port: Number(process.env.REDIS_PORT),
            password: process.env.REDIS_PASSWORD,
        },
        concurrency: 10,
    }
);

/* ============================================================
   WORKER EVENT LISTENERS
============================================================ */

/**
 * Triggered when a job successfully completes processing.
 */
notificationWorker.on('completed', (job) => {
    logger.info(`[notif-worker] Job ${job.id} completed successfully`);
});

/**
 * Triggered when job processing fails or encounters an unhandled exception.
 */
notificationWorker.on('failed', (job, error) => {
    logger.error(`[notif-worker] Job ${job?.id} failed:`, error);
});

notificationWorker.on('error', (error) => {
    logger.error(`[notif-worker] Worker error:`, error);
})

module.exports = notificationWorker;


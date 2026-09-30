'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const logger = require('./src/utils/logger');
const registerEmailListeners = require('./src/listeners/email.listener');
const registerNotificationListeners = require('./src/listeners/notifications.listener');
const registerScheduler = require('./src/jobs/reconciliation.scheduler');
const reconciliationWorker = require('./src/worker/reconciliation.worker');
const reconciliationQueue = require('./src/queue/reconciliation.queue');
const notificationQueue = require('./src/queue/notifications.queue');
const { emailQueue } = require('./src/queue/email.queue');
const redis = require('./src/cache/redis_connect');
const emailService = require('./src/services/email.service');

let notificationWorker;
let emailWorker;
let stopping;

//--------------DRAIN WORK BEFORE CLOSING DATABASE AND REDIS--------------//
function shutdown(signal, exitCode = 0) {
    if (stopping) return stopping;
    stopping = (async () => {
        logger.info('Purchase worker shutting down', { signal });
        // The sweep can enqueue notifications while draining.
        await reconciliationWorker.close();
        await Promise.all([notificationWorker?.close(), emailWorker?.close()]);
        await Promise.all([reconciliationQueue.close(), notificationQueue.close(), emailQueue.close()]);
        emailService.transporter?.close();
        if (redis.isOpen) redis.destroy();
        await mongoose.disconnect();
        process.exitCode = exitCode;
    })().catch((err) => {
        logger.error('Purchase worker shutdown failed', { errorName: err.name, code: err.code });
        process.exit(1);
    });
    return stopping;
}

async function startWorker() {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
    if (stopping) return mongoose.disconnect();
    registerEmailListeners();
    registerNotificationListeners();
    await registerScheduler();
    if (stopping) return;
    notificationWorker = require('./src/worker/notification.worker');
    emailWorker = require('./src/worker/email.worker');
    await reconciliationWorker.waitUntilReady();
    if (stopping) return;
    reconciliationWorker.run().catch(() => shutdown('worker-failure', 1));
    logger.info('Purchase reconciliation worker running');
}

if (require.main === module) {
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    startWorker().catch((err) => {
        logger.error('Purchase worker startup failed', { errorName: err.name, code: err.code });
        return shutdown('startup-failure', 1);
    });
}

module.exports = { startWorker, shutdown };

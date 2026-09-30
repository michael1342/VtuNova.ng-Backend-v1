'use strict';

const queue = require('../queue/reconciliation.queue');
const config = require('../config/reconciliation');
const logger = require('../utils/logger');

//--------------ONE PERSISTENT SCHEDULE ACROSS ALL INSTANCES--------------//
async function registerReconciliationScheduler() {
    await queue.setGlobalConcurrency(1);
    await queue.upsertJobScheduler(
        config.schedulerId,
        { every: config.sweepIntervalMs },
        { name: config.jobName, data: {} }
    );
    logger.info('Purchase reconciliation scheduler registered', {
        schedulerId: config.schedulerId,
        sweepIntervalMs: config.sweepIntervalMs,
    });
}

module.exports = registerReconciliationScheduler;

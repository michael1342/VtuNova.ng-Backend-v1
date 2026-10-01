'use strict';

const { emailQueue } = require('../queue/email.queue');
const config = require('../config/email');

//--------------ONE PERSISTENT RECOVERY SCHEDULE ACROSS INSTANCES--------------//
module.exports = async function registerEmailScheduler() {
    await emailQueue.upsertJobScheduler('email-recovery', { every: config.recoveryIntervalMs }, {
        name: 'recoverEmails', data: {},
        opts: { attempts: 1, removeOnComplete: { count: 20 }, removeOnFail: { count: 100 } },
    });
};

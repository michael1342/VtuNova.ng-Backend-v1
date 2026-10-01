'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const EmailLog = require('../src/models/EmailLog.model');
const cipher = require('../src/utils/email-payload');
const emailService = require('../src/services/email.service');
const logger = require('../src/utils/logger');
let emailQueue;

//--------------EXPLICIT MANUAL INTENT; NEVER DISCOVERED AS AN AUTOMATED TEST--------------//
async function main() {
    const [to, eventId] = process.argv.slice(2);
    if (!to || !eventId) throw new Error('usage');
    cipher.validateKey();
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
    await EmailLog.createIndexes();
    emailQueue = require('../src/queue/email.queue').emailQueue;
    const result = await emailService.send('welcome', to, { fullName: 'Email verification test' }, {
        dedupeKey: 'manual:' + eventId, triggeredBy: 'email.manual-test',
    });
    logger.info('Manual email intent', result);
}
main().catch(() => {
    logger.error('Manual email could not be queued. Check configuration. Usage: npm run email:manual -- recipient event-id');
    process.exitCode = 1;
}).finally(async () => {
    await emailQueue?.close();
    await mongoose.disconnect();
});

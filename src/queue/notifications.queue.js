const {Queue} = require('bullmq');
require('dotenv').config();

const notificationQueue = new Queue('notificationQueue', {
    redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379,
        password: process.env.REDIS_PASSWORD || undefined,
    },
    defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: true,
    },
});

module.exports = { notificationQueue };
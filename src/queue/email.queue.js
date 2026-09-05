const { Queue } = require('bullmq');
require('dotenv').config();

const emailQueue = new Queue('emailQueue', {
    redis: {
        host: process.env.REDIS_HOST,
        port: process.env.REDIS_PORT,
        password: process.env.REDIS_PASSWORD,
    },
    defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: true,
    },
});

module.exports = {
    emailQueue
}
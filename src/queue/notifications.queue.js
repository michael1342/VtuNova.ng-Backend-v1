const {Queue} = require('bullmq');
require('dotenv').config();
console.log('notificationQueue.js loaded');

const notificationQueue = new Queue('notificationQueue', {
    connection: {
        host: process.env.REDIS_HOST ,
        port: Number(process.env.REDIS_PORT) ,
        password: process.env.REDIS_PASSWORD,
    },
    defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: true,
    },
});

notificationQueue.on('completed', (job) => {
    console.log(`Job ${job.id} completed!`);
});

module.exports =  notificationQueue 
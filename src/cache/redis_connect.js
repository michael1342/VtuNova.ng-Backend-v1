const {createClient} = require('redis');
require('dotenv').config();
const logger = require('../utils/logger');

const redisClient = createClient({
   url: process.env.REDIS_URL
});

redisClient.on('error', (err) => logger.error('Redis Client Error', err));
redisClient.on('connect', () => logger.info('Redis client connected'));

(async () => {
    await redisClient.connect();
})();

module.exports = redisClient;
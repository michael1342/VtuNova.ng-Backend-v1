const redisClient = require('./redis_connect');
const logger = require('../utils/logger');

class RedisCache {
    constructor() {
    }

    async set(data, keyName) {
        const cacheKey = `${keyName}:${data._id}`;
        const save = await redisClient.setEx(cacheKey, 24 * 60 * 60, JSON.stringify(data));
        if (!save) {
            logger.error(`Failed to set cache for key: ${cacheKey}`);
            throw new Error('Failed to set cache');
        }
        logger.info(`Cache set for key: ${cacheKey}`);
    }

    async retrieve(data, keyName) {
        const cacheKey = `${keyName}:${data._id}`;
        const cachedData = await redisClient.get(cacheKey);
        if (!cachedData) {
            logger.info(`Cache miss for key: ${cacheKey}`);
            //   throw new Error('Cache miss');
            return
        }
        logger.info(`Cache hit for key: ${cacheKey}`);
        const decoded = JSON.parse(cachedData);
        decoded.cache = 1;
        return decoded;

    }

    async invalidate(data, keyName) {
        const cacheKey = `${keyName}:${data._id}`;
        const update = await redisClient.del(cacheKey);
        if (!update) {
            logger.error(`Failed to invalidate cache for key: ${cacheKey}`);
            return null
        }
        logger.info(`Cache invalidated for key: ${cacheKey}`);
    }
}

module.exports = new RedisCache();
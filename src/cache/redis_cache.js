const redisClient = require('./redis_connect');
const logger = require('../utils/logger');

class RedisCache {
    constructor() {}

    /**
     * Set cache entry
     * @param {*} data - Content to store
     * @param {string} keyName - Key name
     * @param {number} [ttl=86400] - TTL in seconds (default 24h)
     */
    async set(data, keyName, ttl = 24 * 60 * 60) {
        const cacheKey = `${keyName}`;
        const save = await redisClient.setEx(cacheKey, ttl, JSON.stringify(data));
        if (!save) {
            logger.error(`Failed to set cache for key: ${cacheKey}`);
            throw new Error('Failed to set cache');
        }
        logger.info(`Cache set for key: ${cacheKey}`);
        return true;
    }

    /**
     * Retrieve cache entry
     * @param {string} keyName - Key name
     */
    async retrieve(keyName) {
        const cacheKey = `${keyName}`;
        const cachedData = await redisClient.get(cacheKey);
        if (!cachedData) {
            logger.info(`Cache miss for key: ${cacheKey}`);
            return null;
        }
        logger.info(`Cache hit for key: ${cacheKey}`);
        const decoded = JSON.parse(cachedData);
        if (typeof decoded === 'object' && decoded !== null && !Array.isArray(decoded)) {
            decoded.cache = 1;
        }
        return decoded;
    }

    /**
     * Invalidate cache entry
     * @param {string} keyName - Key name
     */
    async invalidate(keyName) {
        const cacheKey = `${keyName}`;
        const update = await redisClient.del(cacheKey);
        if (!update) {
            logger.error(`Failed to invalidate cache for key: ${cacheKey}`);
            return null;
        }
        logger.info(`Cache invalidated for key: ${cacheKey}`);
        return true;
    }

    async clearUserCache(userId) {
        const matchPattern = `user:${userId}:*`;
        let cursor = '0';

        do {
            // Scan for keys matching the user pattern (100 at a time)
            const reply = await redisClient.scan(cursor, {
                MATCH: matchPattern,
                COUNT: 100
            });

            cursor = reply.cursor;
            const keys = reply.keys;

            // If keys are found, delete them all at once
            if (keys && keys.length > 0) {
                await redisClient.del(keys);
                logger.info(`Clearing cache for user ${userId}: deleted ${keys.length} key(s)`);
            }

        } while (cursor !== '0');
        logger.info(`Cache cleared for user ${userId}`);
    }
}

module.exports = new RedisCache();
const logger = require('./logger');

const safe = (name, handler) => async (payload) => {
    try {
        await handler(payload);
    } catch (err) {
        logger.error(`Event listener "${name}" failed: ${err.message}`, {
            stack: err.stack,
        });
    }
};

module.exports = { safe };

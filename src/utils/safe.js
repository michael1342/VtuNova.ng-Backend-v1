const safe = (name, handler) => async (payload) => {
    try {
        await handler(payload);
    } catch (err) {
        logger.error(`Email listener "${name}" failed: ${err.message}`, {
            stack: err.stack,
        });
    }
};

module.exports = { safe };
const EventEmiter = require('events');
const logger = require('../utils/logger');

class AppEvent extends EventEmiter {
    constructor() {
        super();
        this.setMaxListeners(50)
    }

    async emitSafe(eventName, payload, { throwOnError = false } = {}) {
        logger.debug(`Event emitted: ${eventName}`);
        const listeners = this.rawListeners(eventName);

        // Await enqueueing so a draining worker does not close queues too early.
        await Promise.all(listeners.map(async (listener) => {
            try {
                await listener.call(this, payload);
            } catch (err) {
                logger.error('Event listener failed', { eventName });
                if (throwOnError) throw new Error('event_listener_failed');
            }
        }));
    }
}

module.exports = new AppEvent();

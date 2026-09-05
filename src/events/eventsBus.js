const EventEmiter = require('events');
const logger = require('../utils/logger');

class AppEvent extends EventEmiter {
    constructor() {
        super();
        this.setMaxListeners(50)
    }

     emitSafe(eventName, payload) {
    logger.debug(`Event emitted: ${eventName}`);
 const listeners = this.rawListeners(eventName);

    for (const listener of listeners) {
      try {
        const result = listener.call(this, payload);
        if (result && typeof result.then === 'function') {
          result.catch((err) =>
            logger.error(`Async event listener for "${eventName}" rejected: ${err}`)
          );
        }
      } catch (err) {
        logger.error(`Event listener for "${eventName}" threw: ${err.message}`);
      }
    }
  }
}

module.exports = new AppEvent();
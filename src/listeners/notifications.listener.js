const eventBus = require('../events/eventsBus.js');

const { safe } = require('../utils/safe');
const logger = require('../utils/logger.js');
const { notificationQueue } = require('../queue/notifications.queue.js');

const registerNotificationListeners = () => {

    eventBus.on(
        'airtime.purchase',
        safe('airtimePurchaseNotification', async ({ transaction, user }) => {
            if (!transaction || !user) return;

    
            await notificationQueue.add('createNotification', {
                transactionId: transaction._id,
                userId: user._id
            });

            logger.info('Airtime purchase notification queued successfully');
        })
    );

    eventBus.on(
        'data.purchase',
        safe('dataPurchaseNotification', async ({ transaction, user }) => {
            if (!transaction || !user) return;

            await notificationQueue.add('createNotification', {
                transactionId: transaction._id,
                userId: user._id
            });

            logger.info('Data purchase notification queued successfully');
        })
    );

    const count = eventBus.eventNames().length;

    logger.info(
        `Notification listeners registered for ${count} event type(s)`
    );
};

module.exports = registerNotificationListeners;

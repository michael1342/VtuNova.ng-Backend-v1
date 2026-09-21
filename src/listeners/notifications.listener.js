const eventBus = require('../events/eventsBus.js');
const EVENTS = require('../events/events');
const { safe } = require('../utils/safe');
const logger = require('../utils/logger.js');
const  notificationQueue  = require('../queue/notifications.queue'); 

const registerNotificationListeners = () => {

    eventBus.on(
        EVENTS.AIRTIME_PURCHASE,
        safe('airtimePurchaseNotification', async ({ transaction, user }) => {
            if (!transaction || !user) return;

    
            await notificationQueue.add('airtimePurchase', {
                transactionId: transaction._id,
                userId: user._id,
                type: 'transaction',
                category: 'airtime',
                product_name: 'Airtime',
                amount: transaction.amount,
                service: transaction.service
            });

            logger.info('Airtime purchase notification queued successfully');
        })
    );

    eventBus.on(
        EVENTS.DATA_PURCHASE,
        safe('dataPurchaseNotification', async ({ transaction, user }) => {
            if (!transaction || !user) return;

            await notificationQueue.add('createNotification', {
                transactionId: transaction._id,
                userId: user._id,
                type: 'transaction',
                category: 'data'
            });

            logger.info('Data purchase notification queued successfully');
        })
    );

    eventBus.on(
        EVENTS.USER_LOGIN,
        safe('loginAlert', async ({ user, ip, device }) => {
          

            await notificationQueue.add('loginAlert', {
                userId: user._id,
                type: 'security',
                ip,
                device,
                category: 'loginAlert'
            });

            logger.info('User login notification queued successfully');
        })
    );

    eventBus.on(
        EVENTS.PAYMENT_SUCCESS,
        safe('paymentSuccessNotification', async ({ payment, transaction }) => {
            if (!payment?.userId) return;

            await notificationQueue.add('createNotification', {
                userId: payment.userId,
                transactionId: transaction?._id || payment.transactionId,
                amount: payment.amount,
                type: 'deposit',
                category: 'deposit',
                status: payment.status,
                paymentId: payment._id
            });

            logger.info(`Payment success notification queued for payment ${payment._id}`);
        })
    );

    const count = eventBus.eventNames().length;

    logger.info(
        `Notification listeners registered for ${count} event type(s)`
    );
};

module.exports = registerNotificationListeners;

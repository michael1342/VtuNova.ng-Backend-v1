const eventBus = require('../events/eventsBus.js');
const EVENTS = require('../events/events');
const { safe } = require('../utils/safe');
const logger = require('../utils/logger.js');
const  notificationQueue  = require('../queue/notifications.queue'); 
const formatter = require('../templates/notificationFormatter');

const registerNotificationListeners = () => {

    //--------------SERVICE-SPECIFIC PURCHASE TRANSITIONS--------------//
    for (const [event, category] of [
        [EVENTS.AIRTIME_PURCHASE, 'airtime'],
        [EVENTS.DATA_PURCHASE, 'data'],
        [EVENTS.ELECTRICITY_PURCHASE, 'electricity'],
        [EVENTS.CABLE_TV_PURCHASE, 'cable'],
    ]) {
        eventBus.on(event, safe(`${category}PurchaseNotification`, async ({ transaction, user, status, eventId }) => {
            if (!transaction?._id || !user?._id || !['pending', 'success', 'failed'].includes(status)) return;
            const data = {
                transactionId: String(transaction._id), userId: String(user._id),
                eventId: eventId || `${transaction._id}-${status}`,
                type: 'transaction', category, status,
                walletState: transaction.walletState,
                product_name: transaction.product_name,
                amount: transaction.amount, service: transaction.service,
            };
            
            await notificationQueue.add('vtuPurchase', { ...data }, {
                jobId: data.eventId, attempts: 3, backoff: { type: 'exponential', delay: 1000 },
            });
        }));
    }

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


    eventBus.on(
    EVENTS.TRANSACTION_PENDING,
    safe('pendingPurchaseNotification', async ({ transaction, user }) => {
        if (!transaction?._id || !user?._id) return;

        await notificationQueue.add('createNotification', {
            transactionId: String(transaction._id),
            userId: String(user._id),
            type: 'transaction',
            category: 'vtu',
            status: 'pending',
            product_name: transaction.product_name,
            amount: transaction.amount,
            service: transaction.service
        });

        logger.info('Pending purchase notification queued successfully');
    })
);


    const count = eventBus.eventNames().length;

    logger.info(
        `Notification listeners registered for ${count} event type(s)`
    );
};

module.exports = registerNotificationListeners;

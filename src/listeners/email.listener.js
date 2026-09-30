const eventBus = require('../events/eventsBus.js');
const EVENTS = require('../events/events');
const emailService = require('../services/email.service');
const logger = require('../utils/logger');
const {emailQueue} = require('../queue/email.queue');
// const {EVENTS} = require('../events/events');


/* ============================================================
   HELPERS
============================================================ */

const now = () =>
    new Date().toLocaleString('en-GB', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Africa/Lagos',
    });


const getFullName = (user = {}) =>
    user.fullName ||
    `${user.firstName || ''} ${user.lastName || ''}`.trim() ||
    'there';

const getReference = (transaction) => transaction.requestId ||
    transaction.transactionReference || transaction.reference ||
    transaction.transactionId || String(transaction._id);


const safe = (name, handler) => async (payload) => {
    try {
        await handler(payload);
    } catch (err) {
        logger.error(`Email listener "${name}" failed: ${err.message}`, {
            stack: err.stack,
        });
    }
};


/* ============================================================
   REGISTER EMAIL LISTENERS
============================================================ */

function registerEmailListeners() {

    //--------------SERVICE-SPECIFIC TERMINAL RECEIPTS--------------//
    for (const event of [EVENTS.AIRTIME_PURCHASE, EVENTS.DATA_PURCHASE,
        EVENTS.ELECTRICITY_PURCHASE, EVENTS.CABLE_TV_PURCHASE]) {
        eventBus.on(event, safe('purchaseReceipt', async ({ user, transaction, status, eventId }) => {
            if (!user?._id || !transaction?._id || !['success', 'failed'].includes(status)) return;
            await emailQueue.add('purchaseReceipt', {
                userId: String(user._id), transaction, status, event,
                eventId: eventId || `${transaction._id}-${status}`,
            }, { jobId: eventId || `${transaction._id}-${status}` });
        }));
    }


    /* ========================================================
       ACCOUNT & SECURITY
    ======================================================== */

    eventBus.on(
        EVENTS.USER_CREATED,
        safe('welcomeEmail', async ({ user }) => {
            if (!user?.email) return;

            await emailService.send(
                'welcome',
                user.email,
                {
                    fullName: getFullName(user),
                },
                {
                    triggeredBy: EVENTS.USER_CREATED,
                    dedupeKey: `welcome:${user._id}`,
                    relatedUser: user._id,
                }
            );
        })
    );

    eventBus.on(
        EVENTS.NEW_LOGIN,
        safe('loginAlert', async ({ user, ip, device, browser }) => {
            if (!user?.email) return;
            
            await emailQueue.add('loginAlert', {
                email: user.email,
                subject: 'New Login Alert',
                fullName: getFullName(user),
                time: now(),
                ip,
                device: `${device} (${browser})`,
                message: `Hello ${getFullName(user)}, we noticed a new login to your account from IP address ${ip} using ${device} (${browser}). If this was you, no action is needed. If not, please secure your account immediately.`,
            });
            
        })
    );




    eventBus.on(
        EVENTS.USER_PASSWORD_CHANGED,
        safe('passwordChanged', async ({ user }) => {
            if (!user?.email) return;

            await emailService.send(
                'passwordChanged',
                user.email,
                {
                    fullName: getFullName(user),
                    time: now(),
                },
                {
                    triggeredBy: EVENTS.USER_PASSWORD_CHANGED,
                    relatedUser: user._id,
                }
            );
        })
    );


    eventBus.on(
        EVENTS.USER_PASSWORD_RESET_REQUESTED,
        safe('passwordReset', async ({ user, resetUrl }) => {
            if (!user?.email) return;

            await emailService.send(
                'passwordReset',
                user.email,
                {
                    fullName: getFullName(user),
                    resetUrl,
                },
                {
                    triggeredBy: EVENTS.USER_PASSWORD_RESET_REQUESTED,
                    relatedUser: user._id,
                }
            );
        })
    );


    eventBus.on(
        EVENTS.USER_EMAIL_VERIFICATION_REQUESTED,
        safe('emailVerification', async ({ email, name, otp, expiresInMinutes }) => {
            if (!email || !otp) return;

            await emailService.send(
                'emailVerification',
                email,
                {
                    fullName: name || 'there',
                    otp,
                    expiresInMinutes,
                },
                {
                    triggeredBy:
                        EVENTS.USER_EMAIL_VERIFICATION_REQUESTED,
                }
            );
             logger.info(
            `Email listener "${EVENTS.USER_EMAIL_VERIFICATION_REQUESTED}" registered`
        )
        })
    );


    /* ========================================================
       WALLET
    ======================================================== */

    eventBus.on(
        EVENTS.WALLET_FUNDED,
        safe('walletFunded', async ({ user, transaction, wallet }) => {
            if (!user?.email) return;

            await emailService.send(
                'walletFunded',
                user.email,
                {
                    fullName: getFullName(user),
                    amount: transaction.amount,
                    reference: transaction.reference,
                    paymentMethod:
                        transaction.paymentMethod || 'Online Payment',
                    newBalance: wallet.balance,
                    time: now(),
                },
                {
                    triggeredBy: EVENTS.WALLET_FUNDED,
                    dedupeKey: `walletFunded:${transaction.reference}`,
                    relatedUser: user._id,
                }
            );
        })
    );


    eventBus.on(
        EVENTS.WALLET_DEBITED,
        safe('walletDebit', async ({ user, transaction, wallet }) => {
            if (!user?.email) return;

            await emailService.send(
                'walletDebit',
                user.email,
                {
                    fullName: getFullName(user),
                    amount: transaction.amount,
                    description:
                        transaction.description || transaction.type,
                    reference: transaction.reference,
                    newBalance: wallet.balance,
                    time: now(),
                },
                {
                    triggeredBy: EVENTS.WALLET_DEBITED,
                    dedupeKey: `walletDebit:${transaction.reference}`,
                    relatedUser: user._id,
                }
            );
        })
    );


    /* ========================================================
       VTU PURCHASES / TRANSACTIONS
    ======================================================== */

    eventBus.on(
        EVENTS.TRANSACTION_SUCCESSFUL,
        safe(
            'transactionSuccessful',
            async ({ user, transaction, wallet, eventId }) => {
                if (!user?.email) return;

                await emailService.send(
                    'transactionSuccessful',
                    user.email,
                    {
                        fullName: getFullName(user),

                        service:
                            transaction.product_name ||
                            transaction.service ||
                            transaction.type ||
                            'Transaction',

                        network:
                            transaction.network ||
                            transaction.serviceID ||
                            transaction.provider ||
                            '—',

                        recipient:
                            transaction.recipient ||
                            transaction.billersCode ||
                            transaction.phone ||
                            transaction.phoneNumber ||
                            transaction.meterNumber ||
                            transaction.smartCardNumber ||
                            '—',

                        amount: transaction.amount,

                        reference: getReference(transaction),
                        purchasedCode: transaction.purchasedCode,

                        paymentMethod:
                            transaction.paymentMethod ||
                            'VtuNova Wallet',

                        newBalance:
                            wallet?.balance ??
                            transaction.balanceAfter ??
                            '—',

                        time: now(),

                        transactionId:
                            transaction._id,
                    },
                    {
                        triggeredBy:
                            EVENTS.TRANSACTION_SUCCESSFUL,

                        dedupeKey:
                            eventId || `transactionSuccessful:${getReference(transaction)}`,

                        relatedUser: user._id,
                    }
                );
            }
        )
    );


    eventBus.on(
        EVENTS.TRANSACTION_FAILED,
        safe(
            'transactionFailed',
            async ({ user, transaction, eventId }) => {
                if (!user?.email) return;

                await emailService.send(
                    'transactionFailed',
                    user.email,
                    {
                        fullName: getFullName(user),

                        service:
                            transaction?.product_name ||
                            transaction?.service ||
                            transaction?.type ||
                            'Transaction',

                        amount: transaction.amount,

                        reference: getReference(transaction),
                        walletState: transaction.walletState,

                        reason:
                            transaction.reason ||
                            transaction.failureReason ||
                            'Transaction could not be completed.',

                        time: now(),
                    },
                    {
                        triggeredBy:
                            EVENTS.TRANSACTION_FAILED,

                        dedupeKey:
                            eventId || `transactionFailed:${getReference(transaction)}`,

                        relatedUser: user._id,
                    }
                );
            }
        )
    );


    eventBus.on(
        EVENTS.TRANSACTION_REVERSED,
        safe(
            'transactionReversed',
            async ({ user, transaction, wallet }) => {
                if (!user?.email) return;

                await emailService.send(
                    'transactionReversed',
                    user.email,
                    {
                        fullName: getFullName(user),

                        amount:
                            transaction.amount,

                        reference:
                            transaction.reference ||
                            transaction.transactionId,

                        newBalance:
                            wallet?.balance ??
                            transaction.balanceAfter ??
                            '—',

                        time: now(),
                    },
                    {
                        triggeredBy:
                            EVENTS.TRANSACTION_REVERSED,

                        dedupeKey:
                            `transactionReversed:${transaction.reference}`,

                        relatedUser: user._id,
                    }
                );
            }
        )
    );


    /* ========================================================
       WITHDRAWALS
    ======================================================== */

    eventBus.on(
        EVENTS.WITHDRAWAL_SUCCESSFUL,
        safe(
            'withdrawalSuccessful',
            async ({ user, transaction, wallet }) => {
                if (!user?.email) return;

                await emailService.send(
                    'withdrawalSuccessful',
                    user.email,
                    {
                        fullName: getFullName(user),

                        amount:
                            transaction.amount,

                        bankName:
                            transaction.bankName ||
                            transaction.bank?.name ||
                            '—',

                        accountName:
                            transaction.accountName ||
                            '—',

                        accountNumber:
                            transaction.accountNumber ||
                            '—',

                        reference:
                            transaction.reference,

                        newBalance:
                            wallet?.balance ??
                            transaction.balanceAfter ??
                            '—',

                        time: now(),
                    },
                    {
                        triggeredBy:
                            EVENTS.WITHDRAWAL_SUCCESSFUL,

                        dedupeKey:
                            `withdrawalSuccessful:${transaction.reference}`,

                        relatedUser: user._id,
                    }
                );
            }
        )
    );


    /* ========================================================
       LOG REGISTERED LISTENERS
    ======================================================== */

    const count = eventBus.eventNames().length;

    logger.info(
        `Email listeners registered for ${count} event type(s)`
    );
}


module.exports = registerEmailListeners;

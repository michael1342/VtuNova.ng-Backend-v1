const eventBus = require('../events/eventsBus.js');
const EVENTS = require('../events/events');
const emailService = require('../services/email.service');
const logger = require('../utils/logger');
const crypto = require('node:crypto');
const User = require('../models/User.model');
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
        // Preserve identity when the same event object is emitted again.
        payload.eventId ||= crypto.randomUUID();
        await handler(payload);
    } catch (err) {
        logger.error('Email listener could not persist intent', { listener: name });
        throw new Error('email_intent_unavailable');
    }
};


/* ============================================================
   REGISTER EMAIL LISTENERS
============================================================ */

function registerEmailListeners() {
    if (registerEmailListeners.registered) return;
    registerEmailListeners.registered = true;

    //--------------SERVICE-SPECIFIC TERMINAL RECEIPTS--------------//
    for (const event of [EVENTS.AIRTIME_PURCHASE, EVENTS.DATA_PURCHASE,
        EVENTS.ELECTRICITY_PURCHASE, EVENTS.CABLE_TV_PURCHASE]) {
        eventBus.on(event, safe('purchaseReceipt', async ({ user, transaction, status }) => {
            if (!user?._id || !transaction?._id || !['success', 'failed'].includes(status)) return;
            // Purchase events carry only user ID; snapshot recipient/balance before enqueue.
            if (!user.email) user = await User.findById(user._id).select('email firstName lastName wallet');
            if (!user?.email) return;
            await emailService.send(status === 'success' ? 'transactionSuccessful' : 'transactionFailed',
                user.email, {
                    fullName: getFullName(user),
                    service: transaction.product_name || transaction.service || transaction.type,
                    network: transaction.serviceID || transaction.provider,
                    recipient: transaction.recipient || transaction.billersCode || transaction.phone,
                    amount: transaction.amount,
                    reference: getReference(transaction),
                    purchasedCode: transaction.purchasedCode,
                    walletState: transaction.walletState,
                    newBalance: user.wallet?.balance,
                    transactionId: transaction._id,
                    time: new Date(transaction.settledAt || Date.now()).toLocaleString('en-GB', { timeZone: 'Africa/Lagos' }),
                }, { triggeredBy: event, dedupeKey: `${transaction._id}-${status}`, relatedUser: user._id });
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
        safe('loginAlert', async ({ user, ip, device, browser, eventId }) => {
            if (!user?.email) return;
            
            await emailService.send('loginAlert', user.email, {
                fullName: getFullName(user),
                time: now(),
                ipAddress: ip,
                device: `${device} (${browser})`,
            }, { triggeredBy: EVENTS.NEW_LOGIN, relatedUser: user._id,
                dedupeKey: `login:${user._id}:${user.lastLogin ? new Date(user.lastLogin).toISOString() : eventId}` });
            
        })
    );




    eventBus.on(
        EVENTS.USER_PASSWORD_CHANGED,
        safe('passwordChanged', async ({ user, eventId }) => {
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
                    dedupeKey: `passwordChanged:${user._id}:${user.passwordChangedAt ? new Date(user.passwordChangedAt).toISOString() : eventId}`,
                    relatedUser: user._id,
                }
            );
        })
    );


    eventBus.on(
        EVENTS.USER_PASSWORD_RESET_REQUESTED,
        safe('passwordReset', async ({ user, resetUrl, otp, expiresInMinutes, credential, expiresAt }) => {
            if (!user?.email) return;

            await emailService.send(
                'passwordReset',
                user.email,
                {
                    fullName: getFullName(user),
                    resetUrl, otp, expiresInMinutes,
                },
                {
                    triggeredBy: EVENTS.USER_PASSWORD_RESET_REQUESTED,
                    relatedUser: user._id,
                    dedupeKey: `passwordReset:${credential?.id || user.passwordResetToken}`,
                    expiresAt: expiresAt || user.passwordResetExpires,
                    credential: credential || (user.passwordResetToken ? {
                        kind: 'passwordReset', userId: String(user._id), tokenHash: user.passwordResetToken,
                    } : null),
                }
            );
        })
    );


    eventBus.on(
        EVENTS.USER_EMAIL_VERIFICATION_REQUESTED,
        safe('emailVerification', async ({ email, name, otp, expiresInMinutes, credential, expiresAt }) => {
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
                    dedupeKey: `emailVerification:${credential?.id}`,
                    credential, expiresAt,
                }
            );
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
                    dedupeKey: `walletFunded:${getReference(transaction)}`,
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
                    dedupeKey: `walletDebit:${getReference(transaction)}`,
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
                            transaction._id ? `${transaction._id}-success` : `transactionSuccessful:${getReference(transaction)}`,

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
                            transaction._id ? `${transaction._id}-failed` : `transactionFailed:${getReference(transaction)}`,

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
                            `transactionReversed:${getReference(transaction)}`,

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
                            `withdrawalSuccessful:${getReference(transaction)}`,

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

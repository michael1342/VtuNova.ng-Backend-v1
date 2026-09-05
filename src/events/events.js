const EVENTS = Object.freeze({
    USER_LOGGED_IN: 'userLoggedIn',
    USER_LOGGED_OUT: 'userLoggedOut',
    USER_CREATED: 'userCreated',
    USER_UPDATED: 'userUpdated',
    USER_DELETED: 'userDeleted',
    TRANSACTION_CREATED: 'transactionCreated',
    TRANSACTION_UPDATED: 'transactionUpdated',
    TRANSACTION_DELETED: 'transactionDeleted',
    WALLET_CREATED: 'walletCreated',
    WALLET_UPDATED: 'walletUpdated',
    WALLET_DELETED: 'walletDeleted',
    WALLET_FUNDED: 'walletFunded',
})

module.exports = EVENTS
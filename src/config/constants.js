module.exports = {
    ROLES: {
        ADMIN: 'admin',
        USER: 'user',
        Vendor: 'vendor',
    },
    TRANSACTION_STATUSES: {
        PENDING: 'pending',
        SUCCESS: 'success',
        FAILED: 'failed',
        REVERSED: 'reversed',
    },
    WALLET_STATES: {
        RESERVED: 'reserved',
        CHARGED: 'charged',
        RELEASED: 'released',
        REFUNDED: 'refunded',
    },
    TRANSACTION_TYPES: {
        FUND_WALLET: 'fund_wallet',
        AIRTIME: 'airtime',
        DATA: 'data',
        ELECTRICITY: 'electricity',
        CABLE: 'cable',
    }
}

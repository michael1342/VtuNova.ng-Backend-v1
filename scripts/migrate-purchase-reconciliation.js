'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
mongoose.set('autoIndex', false);
mongoose.set('autoCreate', false);
const Transaction = require('../src/models/Transaction.model');
const Notification = require('../src/models/Notification.model');

//--------------ADDITIVE INDEX MIGRATION; NO BALANCE OR RECORD REWRITES--------------//
async function migrate() {
    await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false });
    try {
        const duplicates = await Transaction.aggregate([
            { $match: { provider: { $type: 'string' }, requestId: { $type: 'string' } } },
            { $group: { _id: { provider: '$provider', requestId: '$requestId' }, count: { $sum: 1 } } },
            { $match: { count: { $gt: 1 } } }, { $limit: 1 },
        ]);
        if (duplicates.length) {
            const err = new Error('Duplicate purchase identities require manual investigation');
            err.code = 'DUPLICATE_PURCHASE_IDENTITY';
            throw err;
        }
        console.log('Purchase identity audit passed. Required indexes:', {
            transactions: Transaction.schema.indexes(), notifications: Notification.schema.indexes(),
        });
        if (process.argv.includes('--apply')) {
            await Transaction.createIndexes();
            await Notification.createIndexes();
            console.log('Missing indexes created; existing indexes, purchases and balances preserved.');
        } else {
            console.log('Dry run only. Add --apply to create missing indexes.');
        }
    } finally {
        await mongoose.disconnect();
    }
}

if (require.main === module) migrate().catch((err) => {
    console.error('Reconciliation index migration failed', { errorName: err.name, code: err.code });
    process.exitCode = 1;
});

module.exports = migrate;

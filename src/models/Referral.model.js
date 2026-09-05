const mongoose = require('mongoose');

const ReferralSchema = new mongoose.Schema({
    referrerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
    },
    // referredId: {
    //     type: mongoose.Schema.Types.ObjectId,
    //     ref: 'User',
    // },
    amount: {
        type: Number,
        required: true
    },
    status: {
        type: String,
        default: 'pending'
    },
    timestamp: {
        type: Date,
        default: Date.now
    }
});

ReferralSchema.virtual('referredUser', function() {
    // return this.referredId.transactions ? this.referredId.transactions : [];
    // return this.referredId
})

module.exports = mongoose.model('Referral', ReferralSchema);
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { ROLES } = require('../config/constants');
const generateReferralCode = require('../utils/generateReferralCode');

const userSchema = new mongoose.Schema({
    firstName: {
        type: String,
        required: true
    },
    lastName: {
        type: String
    },

    email: {
        type: String,
        required: true,
        unique: true
    },

    password: {
        type: String,
        required: true
    },

    phone: {
        type: String,
        unique: true,
        sparse: true
    },

    role: {
        type: String,
        enum: Object.values(ROLES),
        default: ROLES.USER
    },

    gender: {
        type: String,
        // enum: ['male', 'female']
    },

    dateOfBirth: {
        type: Date
    },

    referralCode: {
        type: String,
        unique: true,
        sparse: true
    },

    referredBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'user'
    },  

    wallet: {
        balance: {
            type: Number,
            default: 0
        },
        currency: {
            type: String,
            default: "NGN"
        },
        walletStatus: {
            type: String,
            default: "active",
            enum: ["active", "inactive"]
        }
    },

    referrals: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Referral',
        referralBalance: {
            type: Number,
        },
        currency: {
            type: String,
            default: 'NGN'
        }
    }],

    notifications: [{
        type: String,
        ref: 'Notification'
    }],

    status: {
        type: String,
        enum: ["active", "inactive", 'suspended', 'banned'],
        default: "active"
    },

    transactions: [{
        type: String,
        ref: 'Transaction',
    }],

    profilePic: {
        url: String,
        filename: String
    },

    lastLogin: {
        type: Date,
        default: Date.now
    },
    loginIps: [{
        type: String
    }],
    loginDevices: [{
        type: String
    }],
    loginBrowsers: [{
        type: String
    }],
    emailVerified: {
        type: Boolean,
        default: false
    },
    phoneNumberVerified: {
        type: Boolean,
        default: false
    },

    passwordChangedAt: Date,
    passwordResetToken: String,
    passwordResetExpires: Date

}, {
    timestamps: true
});

userSchema.pre('save', async function () {
    if (!this.isModified('password')) return;

    this.password = await bcrypt.hash(this.password, 12);
});

userSchema.virtual('age').get(function () {
    return Math.floor((Date.now() - this.dateOfBirth) / (365.25 * 24 * 3600 * 1000))
})


userSchema.pre('save', async function () {
    if (this.isNew) {
        this.referralCode = await generateReferralCode();
    }
})


userSchema.methods.changedPasswordAfter = function (jwtTimestamp) {
    if(this.passwordChangedAt) {
        return parseInt(this.passwordChangedAt.getTime() / 1000, 10) > jwtTimestamp
    }
} 

userSchema.methods.comparePassword = async function (user) {
    return bcrypt.compare(user, this.password)
} 


userSchema.set('toJSON', {
    transform: (_, ret) => {
        delete ret.password;
        return ret;
    }
});

module.exports = mongoose.model('User', userSchema);
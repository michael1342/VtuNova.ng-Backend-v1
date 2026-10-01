'use strict';

//--------------READ LIVE CREDENTIAL STATE WITHOUT REGENERATING IT--------------//
async function isCurrent(credential, to, now) {
    if (!credential) return true;
    if (credential.kind === 'otp') {
        const redis = require('../cache/redis_connect');
        const cacheKeys = require('../utils/cacheKeys');
        const raw = await redis.get(cacheKeys.otp(to, credential.purpose));
        if (!raw) return false;
        const current = JSON.parse(raw);
        return current.credentialId === credential.id && new Date(current.expiresAt) > now;
    }
    if (credential.kind === 'passwordReset') {
        const User = require('../models/User.model');
        const user = await User.findById(credential.userId).select('+passwordResetToken +passwordResetExpires');
        return Boolean(user && user.passwordResetToken === credential.tokenHash && user.passwordResetExpires > now);
    }
    return false;
}

module.exports = { isCurrent };

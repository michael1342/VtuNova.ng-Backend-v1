const crypto = require('crypto');
const redisClient = require('../cache/redis_connect');
const redisCache = require('../cache/redis_cache');
const cacheKeys = require('../utils/cacheKeys');
const eventBus = require('../events/eventsBus');
const EVENTS = require('../events/events');
const AppError = require('../utils/AppError');

const DEFAULT_OTP_TTL_SECONDS = 10 * 60;

class OtpService {
    generateOtp() {
        //6-digit code
        return crypto.randomInt(100000, 1000000).toString();
    }

    getTtlSeconds() {
        return Number(process.env.OTP_EXPIRES_IN) || DEFAULT_OTP_TTL_SECONDS;
    }

    hashOtp(email, otp, purpose) {
        const secret = process.env.OTP_SECRET || process.env.JWT_SECRET || 'invoiceflow-otp-secret';

        return crypto
            .createHmac('sha256', secret)
            .update(`${email.trim().toLowerCase()}:${purpose}:${otp}`)
            .digest('hex');
    }

    async saveOtpToDb(email, otp, purpose) {
        const normalizedEmail = email.trim().toLowerCase();
        const ttlSeconds = this.getTtlSeconds();
        const cacheKey = cacheKeys.otp(normalizedEmail, purpose);

        const payload = {
            email: normalizedEmail,
            purpose,
            otpHash: this.hashOtp(normalizedEmail, otp, purpose),
            expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
        };

        await redisCache.set(payload, cacheKey, ttlSeconds);

        return cacheKey;
    }

    async verifyOtp(email, otp, purpose) {
        const normalizedEmail = email.trim().toLowerCase();
        const cacheKey = cacheKeys.otp(normalizedEmail, purpose);
        const savedOtp = await redisCache.retrieve(cacheKey);

        if (!savedOtp) {
            throw new AppError('OTP has expired or is invalid.', 400);
        }

        const payload = savedOtp;
        const incomingHash = this.hashOtp(normalizedEmail, otp, purpose);

        if (payload.otpHash !== incomingHash) {
            throw new AppError('Invalid OTP.', 400);
        }

        await redisClient.del(cacheKey);
        return true;
    }

    async createEmailVerificationOtp(email, name) {
        const otp = this.generateOtp();
        await this.saveOtpToDb(email, otp, 'email_verification');

        eventBus.emitSafe(EVENTS.USER_EMAIL_VERIFICATION_REQUESTED, {
            email,
            name,
            otp,
            expiresInMinutes: Math.ceil(this.getTtlSeconds() / 60),
        });
    }

    async createPasswordResetOtp(user) {
        const otp = this.generateOtp();
        await this.saveOtpToDb(user.email, otp, 'password_reset');

        eventBus.emitSafe(EVENTS.USER_PASSWORD_RESET_REQUESTED, {
            user,
            otp,
            expiresInMinutes: Math.ceil(this.getTtlSeconds() / 60),
        });
    }
}

module.exports = new OtpService();

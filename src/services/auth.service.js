const User = require('../models/User.model')
const AppError = require('../utils/AppError')
const jwt = require('jsonwebtoken')
const bcrypt = require('bcryptjs')
const eventBus = require('../events/eventsBus')
const EVENTS = require('../events/events')
const RedisCache = require('../cache/redis_cache')
const cacheKeys = require('../utils/cacheKeys')
const logger = require('../utils/logger')
const crypto = require('crypto')
const OtpService = require('./otp.service')
const { getBrowser, getDevice } = require('../utils/userAgent')


const signInToken = (userId) => jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: process.env.EXPIRES_IN })
const refreshToken = (userId) => jwt.sign({ userId }, process.env.REFRESH_SECRET, { expiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN })

class AuthService {
    constructor() {}

    generateId() {
        const characters = "abcdefghijklmnopqrstuvwxyz0123456789";
        let result = "";
        const length = 8;

        while (result.length < length) {
            const bytes = crypto.randomBytes(length);

            for (const byte of bytes) {
                result += characters[byte % characters.length];

                if (result.length === length) {
                    break;
                }
            }
        }

        return result;
    }

    async register(req) {
        const { firstName, lastName, email, password, phoneNumber, referredBy } = req.body
        if (!firstName || !lastName || !email || !password) {
           throw new AppError('All fields are required', 400)
        }
        const existing = await User.findOne({ email });
        if (existing) {
            throw new AppError('User already exists', 400)
        }

        const otpId = this.generateId()
        const pendingKey = `pending-registration:${otpId}`
        const cache = await RedisCache.retrieve(pendingKey)
        if(cache) {
            return {
     
            message: "OTP already sent to your email",
            otpId,

            }
        }

        await OtpService.createEmailVerificationOtp(email, firstName);

        // Store registration data temporarily
        const data = { firstName, lastName, email, password, phoneNumber, referredBy };
      
        await RedisCache.set(
            data,
            pendingKey,
            300 // 5 minutes
        );

        return {
            message: "OTP sent to your email",
            otpId,
        };
      
    
    }

    async verifyOtp(otp, otpId) {
                if (!otp || !otpId) {
            throw new AppError("Email and OTP are required", 400);
        }

        // Get pending registration data
        const registrationData = await RedisCache.retrieve(
            `pending-registration:${otpId}`
        );

        if (!registrationData) {
            throw new AppError(
                "Registration session expired. Please register again.",
                400
            );
        }

        const payload = registrationData;

        // Verify OTP
        const isVerified = await OtpService.verifyOtp(
            payload.email,
            otp,
            "email_verification"
        );

        if (!isVerified) {
            throw new AppError('Error validating OTP', 400);
        }

        //Create user
            const user = await User.create({ ...payload });

            
        // Remove temporary registration data
        await RedisCache.invalidate(`pending-registration:${otpId}`);

        const token = signInToken(String(user._id));

        // eventBus → listener → queue → worker
        eventBus.emitSafe(EVENTS.USER_CREATED, { user });

        // Invalidate cache
        await RedisCache.invalidate(cacheKeys.userProfile(user._id));

        logger.info(`User registered: ${user.email}`);

        const response = {
            success: true,
            message: 'User registered successfully',
            user: user,
            token
        }
        return response
    }

    async resendOtp(otpId) {
        if (!otpId) {
            throw new AppError('OTP ID is required', 400)
        }

        const registrationData = await RedisCache.retrieve(`pending-registration:${otpId}`)
        if (!registrationData) {
            throw new AppError('Registration session expired. Please register again.', 400)
        }

        await OtpService.createEmailVerificationOtp(
            registrationData.email,
            registrationData.firstName
        )
        return {
            message: "OTP sent to your email",
            success: true
        }
    }


    async generateRefreshToken(cookies) {
        if (!cookies) {
            throw new AppError('refresh token is required', 401)
        }

        const decoded = jwt.verify(
            cookies.refreshToken,
            process.env.REFRESH_SECRET
        )

        const user = await User.findById(decoded.userId);

        if (!user) {
            throw new AppError('User not found', 401)
        }

        if (user.status === "suspended") {
            throw new AppError('User is suspended', 403)
        }

        const token = signInToken(user._id)

        return token
    }

    async login(req) {
        const { email, password } = req.body
        if (!email || !password) {
            throw new AppError('All fields are required', 400)
        }
        const user = await User.findOne({ email }).select('+password');
        if (!user) throw new AppError('Invalid credentials', 401)
        const test = await bcrypt.compare(password, user.password)

        if (!test) throw new AppError('Invalid credentials', 401)
        if (user.status === 'suspended') return res.status(400).json({ message: "user is not active" })
        const ip = req.ip || 'unknown'
        const device = getDevice(req.headers['user-agent'])
        const browser = getBrowser(req.headers['user-agent'])
        const isNewLoginContext =
            !user.loginIps?.includes(ip) ||
            !user.loginDevices?.includes(device) ||
            !user.loginBrowsers?.includes(browser)

        const token = signInToken(user._id, { lastLogin: new Date() })
        const refresh_token = refreshToken(user._id, { lastLogin: new Date() })

       

        user.lastLogin = new Date()
        user.loginIps = [...new Set([...(user.loginIps || []), ip])]
        user.loginDevices = [...new Set([...(user.loginDevices || []), device])]
        user.loginBrowsers = [...new Set([...(user.loginBrowsers || []), browser])]

        user.status = 'active'
        await user.save()

        if (isNewLoginContext) {
            eventBus.emitSafe(EVENTS.NEW_LOGIN, {
            user,
            ip,
            device,
            browser,
            isNewLoginContext,
            });
        }

        eventBus.emitSafe(EVENTS.USER_LOGIN, {
            user,
            ip,
            device,
            browser,
            isNewLoginContext,
        });

        await RedisCache.invalidate(cacheKeys.userProfile(user._id))

        const { password: _, ...userData } = user.toJSON()
        return {
            success: true,
            message: 'User logged in successfully',
            user: userData,
            token,
            refresh_token
        }
    }

    async getProfile(req) {
        const user = await User.findById(req.user.id)

        //cache data
        const cacheKey = cacheKeys.userProfile(req.user.id)
        const cache = await RedisCache.retrieve(cacheKey)
        if (!cache) {
            await RedisCache.set(user, cacheKey)
            return { user, message: 'profile fetched successfully' }
        }
        return { user: cache, message: 'profile fetched successfully' }
    }

    async changePassword(req, res, next) {
        const { currentPassword, newPassword } = req.body
        if (!currentPassword || !newPassword) {
            return res.status(400).json({ message: 'All fields are required' })
        }

        const user = await User.findById(req.user.id).select('+password');
        const test = await user.comparePassword(currentPassword)

        if (!test) return res.status(400).json({ message: "current password is incorrect" })

        if (newPassword === currentPassword) return res.status(400).json({ message: "new password cannot be the same as the current password" })

        user.password = newPassword
        user.passwordChangedAt = Date.now()

        await user.save()
        res.status(200).json({ user, message: 'password changed successfully' });
    }

    async logout(req, res, next) {
        const user = await User.findById(req.user.id);
        if (!user) {
            return res.status(404).json({
                message: "User not found"
            });
        }

        if (user.status === 'suspended') {
            return res.status(400).json({ message: "user is suspended" })
        }

        // Clear all user cache
        await RedisCache.clearUserCache(user._id);

        res.clearCookie('token')
        user.status = 'inactive'
        await user.save()
        res.status(200).json({ message: 'user logged out successfully' });
    }
}

module.exports = new AuthService()
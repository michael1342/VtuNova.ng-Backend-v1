const User = require('../models/User.model');
const jwt = require('jsonwebtoken')
const dotenv = require('dotenv').config();
const bcrypt = require('bcryptjs')
const AuthService = require('../services/auth.service')
const eventBus = require('../events/eventsBus')
const EVENTS = require('../events/events')
const RedisCache = require('../cache/redis_cache')
const logger = require('../utils/logger')


const signInToken = (userId) => jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: process.env.EXPIRES_IN })
const refreshToken = (userId) => jwt.sign({ userId }, process.env.REFRESH_SECRET, { expiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN })


exports.register = async (req, res, next) => {
    try {
        const { firstName, lastName, email, password, phoneNumber, referredBy } = req.body
        if (!firstName || !lastName || !email || !password) {
            return res.status(400).json({ message: 'All fields are required' })
        }
        const existing = await User.findOne({ email });
        if (existing) {
            return next(new Error('User already exists'));
        }
        // if (password !== confirmPassword) return res.status(400).json({ message: "passwords do not match" })
        const user = await User.create({ firstName, lastName, email, password, phoneNumber, referredBy });
        const token = signInToken(user._id)
        res.status(200).json({ token, user }, 'user created successfully');
        const data = {
            success: true,
            message: 'User registered successfully',
            user: user
        }
        return data

    } catch (error) {
        next(error)
    }
}

exports.getRefreshTokens = async (req, res) => {
    try {
        const token = await AuthService.generateRefreshToken(req.cookies)
        return res.status(200).json({ token });
    } catch (err) {
        return res.status(500).json({ message: "Internal server error", error: err.message, detail: "Error generating refresh token" });
    }
}

exports.login = async (req, res, next) => {
    try {
        const { email, password } = req.body
        if (!email || !password) {
            return res.status(400).json({ message: 'All fields are required' })
        }
        const user = await User.findOne({ email }).select('+password');
        if (!user) return res.status(404).json({ message: "user not found" })
        const test = await bcrypt.compare(password, user.password)
        // console.log(test)

        if (!test) return res.status(401).json({ message: "Invalid credentials" })

        if (user.status === 'suspended') return res.status(400).json({ message: "user is not active" })
        const token = signInToken(user._id, { lastLogin: new Date() })
        const refresh_token = refreshToken(user._id, { lastLogin: new Date() })

        res.cookie("refreshToken", refresh_token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            maxAge: 7 * 24 * 60 * 60 * 1000,
        });

        user.lastLogin = new Date()



        user.status = 'active'
        await user.save()

        eventBus.emitSafe('user.login', {
            user,
            ip: req.ip,
            device: req.headers['user-agent'],
        });


        const { password: _, ...userData } = user.toJSON()
        return res.status(200).json({ token, refresh_token, user: userData }, 'user logged in successfully');
    } catch (err) {
        console.log(err)
        return res.status(500).json({ message: "Internal server error", error: err.message, detail: "Error logging in user" });
    }
}

exports.getProfile = async (req, res, next) => {
    try {
        const user = await User.findById(req.user.id)

        //cache data
        const cache = await RedisCache.retrieve(user, req.user.id)
        if (!cache) {
            await RedisCache.set(user, req.user.id)
            return res.status(200).json({ user, message: 'profile fetched successfully' });
        }
        return res.status(200).json({ user: cache, message: 'profile fetched successfully' });
    } catch (err) {
        next(err)
        logger.error(`Error fetching profile for user ${req.user.id}: ${err.message}`);
    }
}

exports.changePassword = async (req, res, next) => {
    try {
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
    } catch (err) {
        next(err)
    }
}

exports.logout = async (req, res, next) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) {
            return res.status(404).json({
                message: "User not found"
            });
        }

        if (user.status === 'suspended') {
            return res.status(400).json({ message: "user is suspended" })
        }



        res.clearCookie('token')
        user.status = 'inactive'
        await user.save()
        res.status(200).json({ message: 'user logged out successfully' });
    } catch (err) {
        // next(err)
        res.status(500).json({ message: "Internal server error", error: err.message, detail: "Error logging out user" });
    }
}
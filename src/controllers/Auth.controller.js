const AuthService = require('../services/auth.service')
const logger = require('../utils/logger')

exports.register = async (req, res, next) => {
    try {
     const result =    await AuthService.register(req)
        res.status(200).json({ message: result.message, otpId: result.otpId });
    } catch (error) {
        next(error)
    }
}

exports.verifyOtp = async (req, res, next) => {
    try {
        const { otp, otpId } = req.body
        const result = await AuthService.verifyOtp(otp, otpId)
        return res.status(200).json(result)
    } catch (error) {
        next(error)
    }
}

exports.resendOtp = async (req, res, next) => {
    try {
        const { otpId } = req.body
        const result = await AuthService.resendOtp(otpId)
        return res.status(200).json(result)
    } catch (error) {
        next(error)
    }
}

exports.getRefreshTokens = async (req, res, next) => {
    try {
        const token = await AuthService.generateRefreshToken(req.cookies)
        return res.status(200).json({ token });
    } catch (err) {
        return res.status(500).json({ message: "Internal server error", error: err.message, detail: "Error generating refresh token" });
    }
}

exports.login = async (req, res, next) => {
    try {
        const response = await AuthService.login(req)

         res.cookie("refreshToken", response.refresh_token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            maxAge: 7 * 24 * 60 * 60 * 1000,
        });

        res.status(200).json(response)
    } catch (err) {
       next(err)
    }
}

exports.getProfile = async (req, res, next) => {
    try {
        const response = await AuthService.getProfile(req)
        res.status(200).json(response)
    } catch (err) {
        next(err)
        logger.error(`Error fetching profile for user ${req.user.id}: ${err.message}`);
    }
}

exports.changePassword = async (req, res, next) => {
    try {
        return await AuthService.changePassword(req, res, next)
    } catch (err) {
        next(err)
    }
}

exports.logout = async (req, res, next) => {
    try {
        return await AuthService.logout(req, res, next)
    } catch (err) {
        next(err)
    }
}

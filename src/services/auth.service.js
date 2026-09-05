const User = require('../models/User.model')
const AppError = require('../utils/AppError')
const jwt = require('jsonwebtoken')

const signInToken = (userId) => jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: process.env.EXPIRES_IN })

class AuthService {

    async generateRefreshToken(refreshToken) {
        try {
            if (!refreshToken) {
                throw new AppError('refresh token is required', 401)
            }
            console.log(refreshToken)

            const decoded = jwt.verify(
                refreshToken.refreshToken,
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

        } catch (err) {
            throw new AppError(err, 401)
        }
    }
}

module.exports = new AuthService()
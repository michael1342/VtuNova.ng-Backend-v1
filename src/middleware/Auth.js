const User = require('../models/User.model')
const jwt = require('jsonwebtoken')
const dotenv = require('dotenv').config()
const { ROLES } = require('../config/constants')


const Protect = async (req, res, next) => {
    try {
        const auth = req.headers.authorization
        if (!auth?.startsWith('Bearer')) return res.status(401).json({ message: "Unauthorized" })
        const token = auth.split(' ')[1]
    
        req.cookies.token = token
        const decoded = jwt.verify(token, process.env.JWT_SECRET)

        const user = await User.findById(decoded.userId).select('+passwordChangedAt')

        if (!user) return res.status(401).json({ message: "user not found" })
        if (user.status === 'suspended') return res.status(401).json({ message: "user is not active" })

        if (user.changedPasswordAfter(decoded.iat)) return res.status(401).json({ message: "password changed recently" })
        req.user = user
        next()
    } catch (err) {
        if (err.name === 'JsonWebTokenError') return next(err, 401);
        if (err.name === 'TokenExpiredError') return res.status(401).json({ message: "token expired" });
        next(err);
    }
}

const restrictTo = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user?.role)) return next(new Error('You do not have permission to perform this action'));
  next()
}

const AdminOnly = restrictTo(ROLES.ADMIN)

module.exports = {Protect, AdminOnly} 
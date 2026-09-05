const adminService = require('../services/admin.service')
// const adminService = require('../services/admin.service')


exports.getTransactions = async (req, res, next) => {
    try {
        const transactions = await adminService.showTransactions(req, res, next)
        res.status(200).json({ transactions })
    } catch (err) {
        next(new Error(err.message), 500)
    }
}


exports.getOneTransaction = async (req, res, next) => {
    try {
        const transaction = await adminService.showOneTransaction(req, res, next)
        // return res.status(200).json({ transaction })
    } catch (err) {
        next(err)
    }
}

exports.getUsers = async (req, res, next) => {
    try {
        const data = await adminService.showAllUsers(req, res, next)
        return res.status(200).json({ data })
    } catch (err) {
        next(err)
    }
}

exports.getOneUser = async (req, res, next) => {
    try {
        const user = await adminService.showOneUser(req, res, next)
        return res.status(200).json({ user: user })
    } catch (err) {
        next(err)
    }
}

exports.suspendUser = async (req, res, next) => {
    try {
        const user = await adminService.suspendUser(req, res, next)
        return res.status(200).json({ message: 'user suspended successfully', user: user })
    } catch (err) {
        next(err)
    }
}

exports.activateUser = async (req, res, next) => {
    try {
        const user = await adminService.activateUser(req, res, next)
        return res.status(200).json({ message: 'user activated successfully', user: user })
    } catch (err) {
        next(err)
    }
}

exports.freezeWallet = async (req, res, next) => {
    try {
        const user = await adminService.freezeWallet(req, res, next)
        return res.status(200).json({ message: 'wallet frozen successfully', user: user })
    } catch (err) {
        next(err)
    }
}

exports.activateWallet = async (req, res, next) => {
    try {
        const user = await adminService.activateWallet(req, res, next)
        return res.status(200).json({ message: 'wallet activated successfully', user: user })
    } catch (err) {
        next(err)
    }
}

exports.adjustWalletBalance = async (req, res, next) => {
    try {
        const user = await adminService.adjustWalletBalance(req.body, req.params.id)
        return res.status(200).json({ message: 'wallet balance adjusted successfully', user: user })
        await user.save()
    } catch (err) {
        next(err)
    }
}

exports.getUsersTransactions = async (req, res, next) => {
    try {
        const transactions = await adminService.fetchUsersTransactions(req, res, next)
        return res.status(200).json({ transactions })
    } catch (err) {
        next(err)
    }
}
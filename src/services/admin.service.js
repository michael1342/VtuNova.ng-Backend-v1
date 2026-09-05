const Transaction = require('../models/Transaction.model')
const User = require('../models/User.model')
const { ROLES } = require('../config/constants')

class AdminService {
    constructor() {

    }

    //------------Transactions------------//
    async showTransactions(req, res, next) {
        try {
            const transactions = await Transaction.find()
            const user = await User.findById(req.user._id)
            // console.log(user)
            if (!transactions) return next('no transaction found')

            return res.status(200).json({ transactions, user })
        } catch (err) {
            next(new Error(err.message), 500)
        }
    }

    async showOneTransaction(req, res, next) {
        try {
            const user = await User.findById(req.user._id)
            const _id = req.params.id
            const email = user.email
            const transaction = await Transaction.find({ email, _id })
            console.log(transaction)


            if (!transaction) return next(new Error('no transaction found'))

            const data = {
                tansaction: transaction,
                user: user
            }
            return res.status(200).json({ data })
        } catch (err) {
            return next(new Error(err.message), 500)
        }
    }

    //------------Users------------//
    async showAllUsers(req, res, next) {
        try {
            const users = await User.find()
            return users
        } catch (err) {
            return next(new Error(err.message), 500)
        }
    }

    async showOneUser(req, res, next) {
        try {
            const user = await User.findById(req.params.id)
            return user
        } catch (err) {
            next(err)
        }
    }

    async suspendUser(req, res, next) {
        try {
            const user = await User.findById(req.params.id)
            user.status = 'suspended'

            if (user.status === 'suspended') return res.status(400).json({ message: "User is already suspended" });

            await user.save()
            return user
        } catch (err) {
            next(err)
        }
    }

    async activateUser(req, res, next) {
        try {
            const user = await User.findById(req.params.id)
            user.status = 'active'
            await user.save()
            return user
        } catch (err) {
            next(err)
        }
    }

    //------------Wallet------------//
    async freezeWallet(req, res, next) {
        try {
            const user = await User.findById(req.params.id)

            if (user.wallet.walletStatus === 'inactive') return res.status(400).json({ message: "Wallet is already frozen" });

            user.wallet.walletStatus = 'inactive'
            await user.save()
            return user
        } catch (err) {
            next(err)
        }
    }

    async activateWallet(req, res, next) {
        try {
            const user = await User.findById(req.params.id)

            if (user.wallet.walletStatus === 'active') return res.status(400).json({ message: "Wallet is already active" });

            user.wallet.walletStatus = 'active'
            await user.save()
            return user
        } catch (err) {
            next(err)
        }
    }

    async adjustWalletBalance(data, id) {
        try {
            const { amount, plus, minus } = data
            const user = await User.findById(id)
            console.log(amount)
            console.log(user.wallet)

            if (!amount) throw new Error('amount is required')

            if (amount <= 0) throw new Error('amount must be greater than 0')
            if (user.wallet.balance == 0 && minus === true) throw new Error('account balance is empty')

            if (plus && minus) throw new Error('cannot add and subtract at the same time')
            plus ? user.wallet.balance += amount : user.wallet.balance
            minus ? user.wallet.balance -= amount : user.wallet.balance
            await user.save()
            return user
        } catch (err) {
            throw new Error(err.message)
        }
    }

    async fetchUsersTransactions(req, res, next) {
        try {
            const user = await User.findById(req.params.id)
            const transactions = await Transaction.aggregate([
                {
                    $match: { user: user._id }
                },
                {
                    $group: {
                        _id: { $month: '$createdAt' },
                        totalAmount: { $sum: '$amount' },
                        largestDeposit: { $max: '$amount' },
                        // count: {$sum: 1},
                        // transactions: {$push: '$$ROOT'}
                    }
                },

            ])
            const data = {
                user,
                transactions
            }
            return data
        } catch (err) {
            next(err)
        }
    }

}

module.exports = new AdminService()
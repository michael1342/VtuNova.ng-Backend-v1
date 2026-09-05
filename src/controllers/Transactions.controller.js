const mongoose = require('mongoose');
const Transaction = require('../models/Transaction.model');
const NotificationService = require('../services/notification.service');
const receiptService = require('../services/receipt.service');
const User = require('../models/User.model');
const RedisCache = require('../cache/redis_cache')
const eventbus = require('../events/eventsBus')
const TransactionService = require('../services/transaction.service')
const logger = require('../utils/logger')

exports.createTransaction = async (req, res, next) => {
    try {
        const user = await User.findById(req.user.id)
        const paystackData = req.paystackTransaction
        const transactionReference = paystackData.data.reference

        const transaction = await Transaction.findOne({ transactionReference })

        if (!transaction) return res.status(400).json({ message: "transaction not found" })

        if (transaction.status === 'success') return res.status(400).json({ message: "Transaction has already been processed" })

    
        const response = await TransactionService.updateTransaction(transaction._id, {
            type: paystackData.data.type,
            status: paystackData.data.status,
            currency: paystackData.data.currency,
            paidAt: paystackData.data.paidAt,
            createdAt: paystackData.data.createdAt,
            paymentMethod: paystackData.data.channel,
            fee: paystackData.data.fees / 100
        });

        if (!response) return res.status(400).json({ message: "Failed to update transaction" })




        if (paystackData.data.status === "success") {
            user.wallet.balance += paystackData.data.amount / 100;
            await user.save();
            await transaction.save()
        }

        //create an event
        eventbus.emitSafe('transaction.created', { transaction, user });

        return res.status(200).json(response)

    } catch (error) {
        return res.status(500).json({ error: 'Failed to create transaction', message: error.message });
    }
};

exports.downloadReceipt = async (req, res, next) => {
    try {
        const { id } = req.params;

        let query = {};
        if (mongoose.Types.ObjectId.isValid(id)) {
            query = { _id: id };
        } else {
            query = {
                $or: [
                    { transactionId: id },
                    { transactionReference: id }
                ]
            };
        }

        const transaction = await Transaction.findOne({ user: req.user.id, ...query }).populate('user');

        if (!transaction) {
            return res.status(404).json({ message: 'Transaction not found' });
        }

        // Check ownership if not admin
        // if (req.user && req.user.role !== 'admin' && transaction.user) {
        //     const transactionUserId = transaction.user._id ? transaction.user._id.toString() : transaction.user.toString();
        //     if (transactionUserId !== req.user.id && transactionUserId !== req.user._id?.toString()) {
        //         return res.status(403).json({ message: 'Unauthorized to download this receipt' });
        //     }
        // }

        const transactionUserId = transaction.user._id ? transaction.user._id.toString() : transaction.user.toString();
        if (transactionUserId !== req.user.id && transactionUserId !== req.user._id?.toString()) {
            return res.status(403).json({ message: 'Unauthorized to download this receipt' });
        }

        const receiptFilename = `VtuNova-Receipt-${transaction.transactionId || transaction.transactionReference || transaction._id}.pdf`;

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${receiptFilename}"`);

        await receiptService.generateReceiptPDF(transaction, res);
        return { transaction, receiptFilename }

    } catch (error) {
        return res.status(500).json({ error: 'Failed to generate receipt', message: error.message });
    }
};
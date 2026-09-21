const mongoose = require('mongoose');
const Transaction = require('../models/Transaction.model');
const receiptService = require('../services/receipt.service');
const TransactionService = require('../services/transaction.service')
const logger = require('../utils/logger')

exports.createTransaction = async (req, res, next) => {
    try {
        await TransactionService.createTransaction(req.body, req)
      
        return res.status(200).json(response)
    } catch (error) {
        next(error)
    }
};

exports.getTransactions = async (req, res, next) => {
    try {
      const transactions = await TransactionService.retrieveTransactions(req.user.id)
        return res.status(200).json(transactions);
    } catch (error) {
        next(error)
    }
};

exports.getOneTransaction = async (req, res, next) => {
    try {
        const transaction = await TransactionService.retrieveOneTransaction(req.params.id)
        return res.status(200).json(transaction);
    } catch (error) {
        next(error)
    }
};

exports.deleteTransaction = async (req, res, next) => {
    try {
        const transaction = await TransactionService.deleteTransaction(req.params.id)
        return res.status(200).json(transaction);
    } catch (error) {
        next(error)
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
       next(err)
    }
};
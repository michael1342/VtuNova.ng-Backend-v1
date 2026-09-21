const logger = require('../utils/logger')
const Transaction = require('../models/Transaction.model')
const RedisCache = require('../cache/redis_cache')
const cacheKeys = require('../utils/cacheKeys')
const User = require('../models/User.model')

class TransactionService {
    async createTransaction(transactionData, req) {
        try {
            const user = await User.findById(req.user._id);
            if (!transactionData) throw new Error('Transaction data not found')
            if(!user) throw new Error('User not found')
            const recipient = (req.body && (req.body.phone || req.body.BillersCode || req.body.billersCode)) || 
                              transactionData?.content?.transactions?.unique_element || 
                              user.phone || 
                              user.email;
                              if(!recipient) return await Transaction.create({ ...transactionData })

         const response =  await Transaction.create({ ...transactionData, recipient });


             //invalidate cache
             await RedisCache.invalidate(cacheKeys.userTransactions(user._id))
             logger.info(`Cache invalidated for user ${user._id}`);

        logger.info(`Transaction saved to DB`);
        return response
        } catch (err) {
            logger.error(`Error saving transaction to DB: ${err.message}`);
            throw new Error(err.message)
        }
    }

    async retrieveTransactions(userId) {
        const transactions = await Transaction.find({ user: userId }).sort({ createdAt: -1 })
        if(!transactions) throw new Error('no transactions found')

            //Cache transaction data
            const key = cacheKeys.userTransactions(userId)
            const cache = await RedisCache.retrieve(key)
            if (!cache) {
                await RedisCache.set(transactions, key)
                logger.info(`Cache set for user ${userId}`);
                return transactions;
            }
        return cache
    }

    async retrieveOneTransaction(transactionId) {
        const transaction = await Transaction.findOne({ user: transactionId })
        if(!transaction) throw new Error('transaction not found')

            //cache transaction data
            const key = cacheKeys.transaction(transactionId)
            const cache = await RedisCache.retrieve(key)
            if (!cache) {
                await RedisCache.set(transaction, key)
                logger.info(`Cache set for transaction ${transactionId}`);
                return transaction;
            }
        return cache
    }


    async deleteTransaction(transactionId) {
        const transaction = await Transaction.findOneAndDelete({ _id: transactionId })
        if(!transaction) throw new Error('transaction not found')

            //invalidate cache
            await RedisCache.invalidate(cacheKeys.transaction(transactionId))
            if (transaction?.user) {
                await RedisCache.invalidate(cacheKeys.userTransactions(transaction.user))
            }
            logger.info(`Cache invalidated for transaction ${transactionId}`);
    }

    async updateTransaction(transactionId, updateData, userId) {
        const transaction = await Transaction.findOneAndUpdate({ _id: transactionId }, { $set: updateData }, { new: true })
        if(!transaction) throw new Error('transaction not found')

            if (userId) {
                await RedisCache.invalidate(cacheKeys.userTransactions(userId))
            } else if (transaction?.user) {
                await RedisCache.invalidate(cacheKeys.userTransactions(transaction.user))
            }

            //invalidate cache
            await RedisCache.invalidate(cacheKeys.transaction(transactionId))
            logger.info(`Cache invalidated for transaction ${transactionId}`);
        return transaction
    }
}

module.exports = new TransactionService();
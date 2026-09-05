const Notification = require('../models/Notification.model')
const Transaction = require('../models/Transaction.model')
const logger = require('../utils/logger')
const RedisCache = require('../cache/redis_cache')

class NotificationService {
  constructor() {

  }

  async createNotification(transactionId, userId) {
   
      const notification = await Notification.create({
        transactionId,
        userId,
      })
      logger.info('Notification created:', notification)

      const transaction = await Transaction.findOne({transactionId}).sort({ createdAt: -1 })
      if (!transaction) throw new Error('transaction not found')

        //invalidate cache
        await RedisCache.invalidate({ notification, transaction}, notification._id)
        logger.info(`Cache invalidated for transaction ${transactionId}`);
        console.log({notification, transaction})

     
      return {notification, transaction}
   
  }

  async retrieveNotification(transactionId) {
    try {
      const notification = await Notification.findOne({
        transactionId: transactionId
      })
        .sort({ createdAt: -1 })
        const transaction = await Transaction.findOne({transactionId}).sort({ createdAt: -1 })

      //cache data
      const cache = await RedisCache.retrieve({notification, transaction}, notification._id)
      if (!cache) {
        await RedisCache.set({notification, transaction}, notification._id)
        logger.info(`Cache set for transaction ${transactionId}: ${JSON.stringify(notification)}`);
        return {notification, transaction}
      }
      console.log(cache)

      return cache
    } catch (err) {
      throw new Error(err.message)
    }
  }

  async retrieveAllNotifications(userId) {
    try {
      const transactions = await Transaction.find({ user: userId }).sort({ createdAt: -1 })
      const notifications = await Notification.find({ userId }).sort({ createdAt: -1 })

      if(!notifications) throw new Error('no notifications found')
        if(!transactions) throw new Error('no transactions found')
      return {notifications, transactions}
    } catch (err) {
      throw new Error(err.message)
    }
  }

  async readNotification(userId) {
    try {
      if (!userId) throw new Error('user id is required')
      const notification = await Notification.updateMany(
        { userId },
        { $set: { isRead: true } }
      );
      if (!notification) throw new Error('notification not found')
      return notification
    } catch (err) {
      throw new Error(err.message)
    }
  }

  async readOneNotification(userId, notificationId) {
    try {
      if (!userId) throw new Error('user id is required')
      const notification = await Notification.updateOne(
        { _id: notificationId },
        { $set: { isRead: true } }
      );
      if (!notification) throw new Error('notification not found')
      return notification
    } catch (err) {
      throw new Error(err.message)
    }
  }

  async unreadOne(userId, notificationId) {
    try {
      if (!userId) throw new Error('user id is required')
      const notification = await Notification.updateOne(
        { _id: notificationId },
        { $set: { isRead: false } }
      );
      if (!notification) throw new Error('notification not found')
      return notification
    } catch (err) {
      throw new Error(err.message)
    }
  }

  async deleteNotification(notificationId) {
    try {
      if (!notificationId) throw new Error('notification id is required')
      const notification = await Notification.findByIdAndDelete(notificationId)
      if (!notification) throw new Error('notification not found')
      return notification
    } catch (err) {
      throw new Error(err.message)
    }
  }

  async clearNotifications(userId) {
  try {
    if (!userId) throw new Error('user id is required')
    const notification = await Notification.deleteMany({ userId })
    if (!notification) throw new Error('notification not found')
    return notification
  } catch (err) {
    throw new Error(err.message)
  }
}
}



module.exports = new NotificationService()

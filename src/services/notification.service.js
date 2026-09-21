const Notification = require('../models/Notification.model')
const Transaction = require('../models/Transaction.model')
const logger = require('../utils/logger')
const RedisCache = require('../cache/redis_cache')
const cacheKeys = require('../utils/cacheKeys')
const TransactionService = require('./transaction.service')
const formatter = require('../templates/notificationFormatter')
const { getBrowser, getDevice } = require('../utils/userAgent')
const AppError = require('../utils/AppError')

class NotificationService {
  constructor() {

  }

  async createNotification({notificationData, userId}) {
    try {
      if (!notificationData) throw new AppError('notification data is required', 400)

    const notification = await Notification.create({
     ...notificationData
    })
    logger.info('Notification created:')

    const transaction = await Transaction.findOne({ transactionId: notificationData?.transactionId }).sort({ createdAt: -1 })

    //invalidate cache
    await RedisCache.invalidate(cacheKeys.userNotifications(notificationData.userId))
    await RedisCache.invalidate(cacheKeys.userProfile(userId))

    return { notification, transaction }
    } catch (err) {
      logger.error(`failed to create notification:${err}`)
      throw new AppError(err.message, 500)
    }
    

  }

  async retrieveNotification(userId, req) {
    try {
      const notification = await Notification.findOne({
        userId: userId
      })
        .sort({ createdAt: -1 })
      const transaction = await Transaction.findOne({ transactionId: userId }).sort({ createdAt: -1 })
      const userAgent = req?.headers?.['user-agent'] || ''
      const device = `${getDevice(userAgent)} (${getBrowser(userAgent)})`

      //format notification
       const formattedNotification = formatter.formatNotification({
                   type: notification?.type,
                   title: notification?.title,
                   message: notification?.message,
                   amount: transaction?.amount || notification?.amount,
                   product_name: transaction?.product_name || notification?.product_name,
                     service: transaction?.service || notification?.service,
                   ip: req?.ip,
                     device,
                     _id: notification._id
               });

              //  let notification = formattedNotification
      

      //cache data
      const key = cacheKeys.userNotifications(userId)
      const cache = await RedisCache.retrieve(key)
      if (!cache) {
        await RedisCache.set( formattedNotification , key)
        return  formattedNotification
      }

      return  cache
    } catch (err) {
      throw new AppError(err.message, 500)
    }
  }

  async retrieveAllNotifications(userId, req) {
    try {
      const transactions = await TransactionService.retrieveTransactions(userId)

      const notifications = await Notification.find({ userId }).sort({ createdAt: -1 })

      const transaction = await Transaction.findOne({ transactionId: userId }).sort({ createdAt: -1 })

      if (!notifications) throw new AppError('no notifications found', 404)
      if (!transactions) throw new AppError('no transactions found', 404)

      const userAgent = req?.headers?.['user-agent'] || ''
      const device = `${getDevice(userAgent)} (${getBrowser(userAgent)})`

        //map through notifications 
        const formattedNotifications = notifications.map((notification) => {
          const notificationData = {
            ...notification,
            type: notification?.type,
            title: notification?.title,
            message: notification?.message,
            amount: transaction?.amount || notification?.amount,
            product_name: transaction?.product_name || notification?.product_name,
            service: transaction?.service || notification?.service,
            ip: req?.ip,
            device,
            category: notification?.category,
            _id: notification._id
          }
          return  formatter.formatNotification(notificationData)
        })

        
      //cache data
      const key = cacheKeys.userNotifications(userId)
      const cache = await RedisCache.retrieve(key)
      if (!cache) {
        await RedisCache.set(formattedNotifications, key)
        return formattedNotifications
      }
      return formattedNotifications
    } catch (err) {
      throw new AppError(err.message, 500)
    }
  }

  async readNotification(userId) {
    try {
      if (!userId) throw new AppError('user id is required', 400)
      const notification = await Notification.updateMany(
        { userId },
        { $set: { isRead: true } }
      );
      if (!notification) throw new AppError('notification not found', 404)
      await RedisCache.invalidate(cacheKeys.userNotifications(userId))
      return notification
    } catch (err) {
      throw new AppError(err.message, 500)
    }
  }

  async readOneNotification(userId, notificationId) {
    try {
      if (!userId) throw new AppError('user id is required', 400)
      const notification = await Notification.updateOne(
        { _id: notificationId },
        { $set: { isRead: true } }
      );
      if (!notification) throw new AppError('notification not found', 404)
      await RedisCache.invalidate(cacheKeys.userNotifications(userId))
      return notification
    } catch (err) {
      throw new AppError(err.message, 500)
    }
  }

  async unreadOne(userId, notificationId) {
    try {
      if (!userId) throw new AppError('user id is required', 400)
      const notification = await Notification.updateOne(
        { _id: notificationId },
        { $set: { isRead: false } }
      );
      if (!notification) throw new AppError('notification not found', 404)
      await RedisCache.invalidate(cacheKeys.userNotifications(userId))
      return {success: true, message: 'Notification marked as unread successfully'}
    } catch (err) {
      throw new AppError(err.message, 500)
    }
  }

  async deleteNotification(notificationId) {

      if (!notificationId) throw new AppError('notification id is required', 400)
      const notification = await Notification.findByIdAndDelete(notificationId)
      if (!notification) throw new AppError('notification not found', 404)
      await RedisCache.invalidate(cacheKeys.userNotifications(notification.userId))

      logger.info(`Notification deleted: ${notificationId}`)
      return {success: true, message: 'Notification deleted successfully'}
    
  }

  async clearNotifications(userId) {
    try {
      if (!userId) throw new AppError('user id is required', 400)
      const notification = await Notification.deleteMany({ userId })
      if (!notification) throw new AppError('notification not found', 404)
      await RedisCache.invalidate(cacheKeys.userNotifications(userId))
      return {success: true, message: 'Notifications cleared successfully'}
    } catch (err) {
      throw new AppError(err.message, 500)
    }
  }
}



module.exports = new NotificationService()

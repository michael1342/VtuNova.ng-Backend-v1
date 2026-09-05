const NotificationService = require('../services/notification.service')
const AppError = require('../utils/AppError')

exports.getOneNotification = async (req, res, next) => {
    try {
        const notification = await NotificationService.retrieveNotification(
            req.params.id
        );
        res.status(200).json({ notification });
    } catch (err) {
        next(err);
    }
};

exports.getAllNotifications = async (req, res) => {
    try {
        // const transactions = await Transaction.findById({ user: req.user.id });
        const response = await NotificationService.retrieveAllNotifications(
            req.user._id
        );
        if (!response) {
            return new AppError('No notifications found', 404);
        }
        return res.status(200).json({ notifications: response.notifications, transactions: response.transactions });
    } catch (err) {
        return new AppError(err.message, 500);
    }
};

exports.setReadNotification = async (req, res) => {
    try {
        const notification = await NotificationService.readNotification(
            req.user.id
        );
        return res.status(200).json({ notification });
    } catch (err) {
        return new AppError(err.message, 500);
    }
}

exports.readOneNotification = async (req, res) => {
    try {
        const notification = await NotificationService.readOneNotification(
            req.user.id,
            req.params.id
        );
        return res.status(200).json({ notification });
    } catch (err) {
        return new AppError(err.message, 500);
    }
}

exports.unreadOneNotification = async (req, res) => {
    try {
        const notification = await NotificationService.unreadOne(
            req.user.id,
            req.params.id
        );
        console.log(notification)
        return res.status(200).json({ notification });
    } catch (err) {
        return new AppError(err.message, 500);
    }
}

exports.deleteNotification = async (req, res) => {
    try {
        const notification = await NotificationService.deleteNotification(
            req.params.id
        );
        return res.status(200).json(notification);
    } catch (err) {
        return new AppError(err.message, 500);
    }
}

exports.clearAllNotifications = async (req, res) => {
    try {
        const notification = await NotificationService.clearNotifications(
            req.user.id
        );
        return res.status(200).json(notification);
    } catch (err) {
        return new AppError(err.message, 500);
    }
}
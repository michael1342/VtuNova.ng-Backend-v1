const NotificationService = require('../services/notification.service')
const AppError = require('../utils/AppError')

exports.getOneNotification = async (req, res, next) => {
    try {
        const notification = await NotificationService.retrieveNotification(
            req.params.id, req
        );
        res.status(200).json({ notification });
    } catch (err) {
        next(err);
    }
};

exports.getAllNotifications = async (req, res, next) => {
    try {
        // const transactions = await Transaction.findById({ user: req.user.id });
        const response = await NotificationService.retrieveAllNotifications(
            req.user._id, req
        );
        if (!response) {
            return res.status(200).json({ notifications: [] });
        }
        return res.status(200).json({ notifications: response });
    } catch (err) {
        next(err)
    }
};

exports.setReadNotification = async (req, res) => {
    try {
        const notification = await NotificationService.readNotification(
            req.user.id
        );
        return res.status(200).json({ notification });
    } catch (err) {
       next(err)
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
       next(err)
    }
}

exports.unreadOneNotification = async (req, res) => {
    try {
        const notification = await NotificationService.unreadOne(
            req.user.id,
            req.params.id
        );
        return res.status(200).json({ notification });
    } catch (err) {
        next(err)
    }
}

exports.deleteNotification = async (req, res) => {
    try {
        const notification = await NotificationService.deleteNotification(
            req.params.id
        );
        return res.status(200).json(notification);
    } catch (err) {
       next(err)
    }
}

exports.clearAllNotifications = async (req, res) => {
    try {
        const notification = await NotificationService.clearNotifications(
            req.user.id
        );
        return res.status(200).json(notification);
    } catch (err) {
        next(err)
    }
}
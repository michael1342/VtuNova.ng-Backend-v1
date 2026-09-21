const router = require('express').Router();

const notificationController = require('../controllers/Notification.controller');
const {Protect} = require('../middleware/Auth');

router.get('/notification/:id', Protect, notificationController.getOneNotification);
router.get('/get-notifications', Protect, notificationController.getAllNotifications);
router.patch('/read-notification', Protect, notificationController.setReadNotification);
router.patch('/read-one-notification/:id', Protect, notificationController.readOneNotification);
router.patch('/unread-notification/:id', Protect, notificationController.unreadOneNotification);
router.delete('/delete-notification/:id', Protect, notificationController.deleteNotification);
router.delete('/clear-notifications', Protect, notificationController.clearAllNotifications);

module.exports = router;
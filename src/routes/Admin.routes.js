const router = require('express').Router();
const adminController = require('../controllers/admin.controller');
const {Protect, AdminOnly} = require('../middleware/Auth');

router.get('/transactions', Protect, AdminOnly, adminController.getTransactions);
router.get('/transactions/:id', Protect, AdminOnly, adminController.getOneTransaction);
router.get('/users', Protect, AdminOnly, adminController.getUsers)
router.get('/users/:id', Protect, AdminOnly, adminController.getOneUser)
router.post('/users/suspend/:id', Protect, AdminOnly, adminController.suspendUser)
router.post('/users/activate/:id', Protect, AdminOnly, adminController.activateUser)
router.post('/wallets/freeze/:id', Protect, AdminOnly, adminController.freezeWallet)
router.post('/wallets/activate/:id', Protect, AdminOnly, adminController.activateWallet)
router.post('/wallets/adjust/:id', Protect, AdminOnly, adminController.adjustWalletBalance)
router.get('/wallets/transactions/:id', Protect, AdminOnly, adminController.getUsersTransactions)

module.exports = router;
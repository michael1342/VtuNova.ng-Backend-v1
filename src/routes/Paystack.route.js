const router = require('express').Router();
const paystackController = require('../controllers/Paystack.controller');
const {Protect} = require('../middleware/Auth');

router.post('/initiate-payment', Protect, paystackController.initiatePayment);

// router.post('/webhook', paystackController.paystackWebhook);

module.exports = router; 
const router = require('express').Router();
const TransactionController = require('../controllers/Transactions.controller');
const {Protect} = require('../middleware/Auth');
const {verifyTransactions} = require('../middleware/verifyPayment');

router.post('/verify/:reference', Protect, verifyTransactions, TransactionController.createTransaction);
router.get('/receipt/:id', Protect, TransactionController.downloadReceipt);

module.exports = router;
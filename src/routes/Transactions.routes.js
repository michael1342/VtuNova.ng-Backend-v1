const router = require('express').Router();
const TransactionController = require('../controllers/Transactions.controller');
const {Protect} = require('../middleware/Auth');

router.get('/receipt/:id', Protect, TransactionController.downloadReceipt);
router.get('/', Protect, TransactionController.getTransactions);
router.get('/:id', Protect, TransactionController.getOneTransaction);
router.delete('/:id', Protect, TransactionController.deleteTransaction);

module.exports = router;
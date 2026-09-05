const router = require('express').Router();
const vtuController = require('../controllers/Vtu.controller');
const {Protect} = require('../middleware/Auth');

router.post('/buy-airtime', Protect, vtuController.buyAirtime);
router.post('/buy-data', Protect, vtuController.buyData);
router.get('/', Protect, vtuController.getDataPlans);
router.post('/verify-meter-number', Protect, vtuController.verifyMeter);
router.post('/buy-electricity', Protect, vtuController.byIkejaElectric);


module.exports = router;
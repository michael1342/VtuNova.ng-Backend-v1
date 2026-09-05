const router = require('express').Router();
const AuthController = require('../controllers/Auth.controller');
const {Protect} = require('../middleware/Auth');
const {AuthRate, refreshRate} = require('../middleware/rateLimit');

router.post('/register', AuthRate, AuthController.register);
router.post('/login', AuthRate, AuthController.login);
router.get('/profile', AuthRate, Protect, AuthController.getProfile);
router.patch('/change-password', AuthRate, Protect, AuthController.changePassword);
router.post('/refresh-token', refreshRate, AuthController.getRefreshTokens);
router.post('/logout', Protect, AuthRate, AuthController.logout);

module.exports = router;
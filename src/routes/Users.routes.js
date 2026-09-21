const router = require('express').Router();
const userController = require('../controllers/User.controller');
const {Protect} = require('../middleware/Auth');
const multer = require('multer');
const {v4: uuid} = require('uuid')
const path = require('path');

router.get('/notification/:id', Protect, userController.getOneNotification);

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, './upload/profile'),
    filename: (req, file, cb) => cb(null, `${uuid()}${path.extname(file.originalname)}`)
})

const upload = multer({
    storage,
    limits: {fileSize: 7 * 1024 * 1024},
    fileFilter: (req, file, cb) => {
        const allowed = /jpeg|jpg|png/
        if (allowed.test(path.extname(file.originalname).toLowerCase()) && allowed.test(file.mimetype)) {
            cb(null, true)
        } else {
            cb(new Error('Only JPEG and PNG images are accepted for profile photos'))
        }
    }
})

// router.get('/get-profile', Protect, authController.getProfile);
router.patch('/upload-profile-pic', Protect, upload.single('photo'), userController.uploadProfilePic);
router.patch('/update-profile', Protect, userController.updateProfile);
router.get('/get-transactions', Protect, userController.getUsersTransactions);
router.post('/save-beneficiary', Protect, userController.saveBeneficiary);
router.patch('/edit-beneficiary/:id', Protect, userController.editBeneficiary);
router.get('/get-beneficiaries', Protect, userController.getBeneficiaries);
router.delete('/delete-beneficiary/:id', Protect, userController.deleteBeneficiary);
router.get('/transaction-chart', Protect, userController.getTransactionChart);

module.exports = router;
const notificationService = require('../services/notification.service');
const Transaction = require('../models/Transaction.model');
const User = require('../models/User.model');
const Beneficiary = require('../models/Beneficiary.model');
const ChartService = require('../services/charts.service')

exports.getOneNotification = async (req, res, next) => {
  try {
    const notification = await notificationService.retriveNotification(
      req.params.id
    );
    res.status(200).json(notification);
  } catch (err) {
    next(err);
  }
};

exports.uploadProfilePic = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        message: "Request must contain a file",
      });
    }

    const photoData = {
      filename: req.file.filename,
      url: `upload/profile/${req.file.filename}`,
    };

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { profilePic: photoData },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Profile photo updated successfully",
      user,
    });
  } catch (err) {
    next(err);
  }
}

exports.updateProfile = async (req, res, next) => {
  try {
    const { firstName, lastName, email, phone, dateOfBirth, gender } = req.body;

    const user = await User.findByIdAndUpdate(req.user._id, { firstName, lastName, email, phone, dateOfBirth, gender }, /* { new: true }  */);
    await user.save();
    res.status(200).json(user);
  } catch (err) {
    next(err)
  }
}

exports.getUsersTransactions = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    const userId = req.query.userId
    const transactions = await Transaction.find({ user: user._id });
    return res.status(200).json({ transactions })
  } catch (err) {
    return res.status(200).json({ error: err })
  }
}

exports.saveBeneficiary = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    const { name, phone, service } = req.body;

    const exist = await Beneficiary.findOne({ userId: user._id, phone });
    if (exist) return res.status(400).json({ message: "Beneficiary already exist" });

    const beneficiary = await Beneficiary.create({ userId: user._id, name, phone, service });

    return res.status(200).json({ beneficiary })
  } catch (err) {
    return res.status(200).json({ error: err })
  }
}

exports.editBeneficiary = async (req, res, next) => {
  try {
    const { name, phone, service } = req.body;
    const { id } = req.params;

    const beneficiary = await Beneficiary.findOneAndUpdate(
      { _id: id, userId: req.user.id },
      { name, phone, service },
      { new: true, runValidators: true }
    );

    if (!beneficiary) {
      return res.status(404).json({
        message: "Beneficiary not found"
      });
    }

    return res.status(200).json({ beneficiary });

  } catch (err) {
    return res.status(500).json({
      error: err.message
    });
  }
};

exports.getBeneficiaries = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    const exist = await Beneficiary.findOne({ userId: user._id });
    if (!exist) return res.status(404).json({ message: "no Beneficiary found" });

    const beneficiary = await Beneficiary.find({ userId: user._id });

    return res.status(200).json({ beneficiary })
  } catch (err) {
    return res.status(200).json({ error: err })
  }
}

exports.deleteBeneficiary = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);

    const exist = await Beneficiary.findOne({ userId: user._id });
    if (!exist) return res.status(400).json({ message: "Beneficiary has already been deleted" });

    const id = req.params.id
    const beneficiary = await Beneficiary.findOneAndDelete({ userId: user._id });

    return res.status(200).json({ message: "user successfully deleted", beneficiary })
  } catch (err) {
    return res.status(200).json({ error: err })
  }
}

//chart
exports.getTransactionChart = async (req, res, next) => {
  try {
    const data = await ChartService.getMonthlyTransactions(req.user.id, req.query.year);
    return res.status(200).json({ data })
  } catch (err) {
    next(err)
  }
}
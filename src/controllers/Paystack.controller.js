
const Transaction = require('../models/Transaction.model');
const User = require('../models/User.model');
const logger = require('../utils/logger');
const PaystackService = require('../services/paystack.service');

exports.initiatePayment = async (req, res) => {
    try {
        const user = await User.findById(req.user._id);

        //wallet status check
        if(user.walletStatus === 'inactive') {
            logger.error('Wallet is inactive');
            return res.status(400).json({ message: "Wallet is inactive" });
        }

        const response = await PaystackService.initializePayment(user, req);


        res.status(200).json(response);
    } catch (error) {
        res.status(500).json({ message: "Internal server error", error: error.message, detail: "Error initiating payment" });
    }
}

exports.verifyPayment = async (req, res) => {
    try {
        const reference = req.params.reference;

        if(!reference) return res.status(400).json({ message: "Reference is required" });

        const response = await PaystackService.verify(reference);
        res.status(200).json(response);
    } catch (error) {
        res.status(500).json({ message: "Internal server error", error: error.message, detail: "Error verifying payment" });
    }
}

exports.handleWebhook = async (req, res) => {
     try {
        console.log('hit')
      const payload = req.body;
      const signature = req.headers['x-paystack-signature'];
      console.log('signature:', signature)

      if (!signature) {
        return res.status(400).json({ status: 'error', message: 'Missing signature' });
      }

      // req.rawBody is captured by express.json({ verify }) in app.js.
      const result = await PaystackService.handleWebhook(payload, signature, req.rawBody);

      return res.status(200).json(result);
    } catch (error) {
      // Return 200 to prevent Paystack from retrying
      next(error)
      logger.error('Webhook error:', error);
      return res.status(200).json({ status: 'error', message: error.message });
    }
}


const Transaction = require('../models/Transaction.model');
const User = require('../models/User.model');
const TransactionService = require('../services/transaction.service');

exports.initiatePayment = async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        const existPay = await Transaction.findOne({ user: req.user._id, status: 'pending' });
        if (existPay) return res.status(400).json({ message: "You have a pending transaction" });


        const response = await paystack.initializeTransaction(user, req);

        if (user.wallet.walletStatus === 'inactive') return res.status(400).json({ message: "Wallet is frozen" });

        const reference = await response.data.reference;
        const amount = req.body.amount
        await TransactionService.createTransaction({
            user: req.user._id,
            transactionReference: reference,
            amount: amount,
            status: 'pending',
            email: user.email
        }, req);
        res.status(200).json(response);
    } catch (error) {
        res.status(500).json({ message: "Internal server error", error: error.message, detail: "Error initiating payment" });
    }
}


exports.verifyTransactions = async (req, res, next) => {
    //     #!/bin/sh
    // url="https://api.paystack.co/bank/resolve?account_number=0022728151&bank_code=063"
    // authorization="Authorization: Bearer YOUR_SECRET_KEY"

    // curl "$url" -H "$authorization" -X GET
    // https://api.paystack.co/bank/resolve?account_number=0022728151&bank_code=063

    try {
        const { reference } = req.params
        const url = `https://api.paystack.co/transaction/verify/${reference}`;
        const response = await fetch(url, {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
            },
        });
        const responseData = await response.json();

        if (!response.ok) {
            // throw new Error(responseData.message || "Failed to verify transaction");
            return res.status(400).json({ message: "Failed to verify transaction", error: responseData.message });
        }

        const transaction = await Transaction.findOne({ transactionReference: reference });
        if (!transaction) {
            return res.status(400).json({ message: "Transaction not found" });
        }
        transaction.status = "success";
        await transaction.save();


        return responseData;
    } catch (err) {
        // next(err)
        return res.status(400).json({ message: "Failed to verify transaction", error: err.message });
    }
}

const verifyTransactions = async (req, res, next) => {
// https://api.paystack.co/bank/resolve?account_number=0022728151&bank_code=063

    try {
        const {reference} = req.params
        const url = `https://api.paystack.co/transaction/verify/${reference}`;
        const response = await fetch(url, {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
            },
        });
        const responseData = await response.json();
        // console.log(responseData)
        
        if (!response.ok) {
            // throw new Error(responseData.message || "Failed to verify transaction");
            return res.status(400).json({ message: "Failed to verify transaction", error: responseData.message });
        }
        req.paystackTransaction = responseData
        next()
    } catch (err) {
        // next(err)
        return res.status(400).json({ message: "Failed to verify transaction", error: err.message });
    }
}

module.exports = {verifyTransactions}
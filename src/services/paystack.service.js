const axios = require('axios')
dotenv.config();

class PayStackService {
  constructor() {
    this.base_url = "https://api.paystack.co";
    this.secret_key = process.env.PAYSTACK_SECRET_KEY;
  }

  async initializeTransaction(user, req) {
    try {
      // const { email, amount, name, phone } = data;

    
      const metadata = {
        user: req.user._id.toString(),
        email: user.email,
        amount: req.body.amount,
        first_name: user.firstName,
        last_name: user.lastName,
        phone: (user.phone || req.body.phone),
        currency: 'NGN',
        purpose: 'wallet'
      }

      const payload = {
        email: user.email,
        amount: req.body.amount,
        first_name: user.firstName,
        last_name: user.lastName,
        phone: (user.phone || req.body.phone),
        currency: 'NGN',
        metadata: metadata,
        callback_url: process.env.CALLBACK_URL || 'http://localhost:5174/wallet',
        reference: this.generateReference()
      }

      const response = axios.post(
        `${this.base_url}/transaction/initialize`,
        payload,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.secret_key}`,
          },
        }
      )
      // const response = await fetch(`${this.base_url}/transaction/initialize`, {
      //   method: "POST",
      //   headers: {
      //     "Content-Type": "application/json",
      //     Authorization: `Bearer ${this.secret_key}`,
      //   },
      //   body: JSON.stringify({ email, amount: amount * 100, first_name: firstName, last_name: lastName, phone }),
      // });
      const responseData = response
      if (!response.ok) {
        throw new Error(
          responseData.message || "Failed to initialize transaction",
        );
      }
      return responseData;
    } catch (error) {
      throw new Error(error.message);
    }
  }

  generateReference() {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 10).toUpperCase();
    return `VTN-${timestamp}-${random}`;
  }
}

module.exports = new PayStackService();

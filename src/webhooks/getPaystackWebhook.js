const dotenv = require('dotenv');
dotenv.config();
const crypto = require('crypto');

// Your Paystack Secret Key (Keep this in your .env file!)
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || "YOUR_SECRET_KEY";

class PaystackWebhookService {
  constructor() {

  }

  async PaystackWebhook(req, res) {
    const event = req.body;

    // 1. Verify the signature
    const hash = crypto
      .createHmac('sha512', PAYSTACK_SECRET_KEY)
      .update(req.rawBody)
      .digest('hex');

    if (hash !== req.headers['x-paystack-signature']) {
      return res.status(401).json({ status: 'error', message: 'Unauthorized signature' });
    }

    // 2. Acknowledge receipt quickly to Paystack
    res.status(200).json({ status: 'success', message: 'Webhook received' });

    // 3. Process the event payload asynchronously

    if (event.event === 'charge.success') {
      const transaction = event.data;
      const customerEmail = transaction.customer.email;
      const amountPaid = transaction.amount / 100; // Convert kobo to standard currency
      const reference = transaction.reference;

      console.log(`Processing successful payment of ${amountPaid} for customer: ${customerEmail}`);

      // TODO: Write your database logic here:
      // - Check if transaction reference is already processed (to avoid duplicates)
      // - Find or create the customer record using customerEmail
      // - Save the transaction linked to that customer
    }
  }
}

module.exports = new PaystackWebhookService();

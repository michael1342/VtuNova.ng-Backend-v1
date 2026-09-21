const axios = require('axios')
require('dotenv').config();
const logger = require('../utils/logger');
const Payment = require('../models/payment.model');
const TransactionService = require('./transaction.service')
const eventBus = require('../events/eventsBus');
const EVENTS = require('../events/events');
const User = require('../models/User.model');
const crypto = require('crypto')
const AppError = require('../utils/AppError')

class PayStackService {
  constructor() {
    this.base_url = "https://api.paystack.co";
    this.secret_key = process.env.PAYSTACK_SECRET_KEY;
    this.public_key = process.env.PAYSTACK_PUBLIC_KEY;
    this.webhookSecret = process.env.PAYSTACK_WEBHOOK_SECRET;
  }

  async initializePayment(user, req) {
    try {

    //Meta Data
      const metadata = {
        user: req.user._id.toString(),
        email: user.email,
        amount: req.body.amount * 100,
        first_name: user.firstName,
        last_name: user.lastName,
        phone: (user.phone || req.body.phone),
        currency: 'NGN',
        purpose: 'wallet'
      }

      //Payload
      const payload = {
        email: user.email,
        amount: req.body.amount * 100,
        first_name: user.firstName,
        last_name: user.lastName,
        phone: (user.phone || req.body.phone),
        currency: 'NGN',
        metadata: metadata,
        callback_url: process.env.CALLBACK_URL || 'http://localhost:5174/wallet',
        reference: this.generateReference()
      }

      //Api Call
      const response = await axios.post(
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

      //Create Transaction
      const transactionPayload = {
        amount: payload.amount / 100,
        status: 'pending',
        user: req.user._id,
        email: user.email
      }
      const transaction = await TransactionService.createTransaction(transactionPayload, req)

      //Create Payment
      const payment = await Payment.create({
        reference: payload.reference,
        authorizationUrl: response.data.data.authorization_url,
        amount: payload.amount / 100,
        currency: payload.currency,
        status: 'pending',
        userId: req.user._id,
        transactionId: transaction._id
      })
  
      const responseData = response.data
      if (!responseData.status) {
        logger.error(`Error initializing transaction: ${responseData.message}`);
        throw new Error(
          responseData.message || "Failed to initialize transaction",
        );
      }
      logger.info(`Transaction initialized: ${responseData.data.authorization_url}`);
      return responseData
    } catch (error) {
      logger.error(`Error initializing payment: ${error.message}`);
      throw new Error(error.message);
    }
  }

  async verify(reference) {
    try {
      if(!reference) throw new Error('Reference is required')

        //Find Payment
        const payment = await Payment.findOne({reference})
      if(!payment) throw new Error('Payment not found')

        // Idempotency check
        const existingPay = await Payment.findOne({reference, status: 'success'})
        if(existingPay) return existingPay
        
      const response = await axios.get(
        `${this.base_url}/transaction/verify/${reference}`,
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.secret_key}`,
          },
        }
      );

       if (!response.data.status) {
        logger.error(`Error verifying transaction: ${response.data.message}`);
        throw new Error(response.data.message || 'Verification failed');
      }

      //Update Payment
      const updatedPayment = await Payment.findOneAndUpdate(
        { reference },
        { status: 'success', paidAt: new Date() },
        { new: true }
      )

      //Update Transaction
      const transaction = await TransactionService.updateTransaction(payment.transactionId, {status: 'success'})

      //Emit Event 
      eventBus.emit(EVENTS.PAYMENT_SUCCESS, {
        payment: updatedPayment,
        transaction,
        providerData: response.data.data
      })

      //Update User Balance
      // const user = await User.findById(payment.userId)
      // user.wallet.balance += response.data.data.amount / 100
      // await user.save()

      return response.data;
    } catch (error) {
      logger.error(`Error verifying payment: ${error.message}`);
      throw new Error(error.message);
    }
  }

  async handleWebhook(payload, signature, rawBody) {

        // Verify webhook signature
      if (!this.verifyWebhookSignature(payload, signature, rawBody)) {
        throw new AppError('Invalid webhook signature', 401);
      }

      
       // Extract event data
      const event = payload.event;
      const data = payload.data;

      logger.info(`Webhook received: ${event} for reference ${data.reference}`);

      // Handle the webhook event
      if (event === 'charge.success') {
         //Find Payment
        const payment = await Payment.findOne({reference: data.reference})
        if(!payment) {
          return {status: 'error', message: 'Payment not found'}
        }

        if (payment.status === 'success') {
          return {status: 'success', message: 'Payment already processed'}
        }

        //Update Payment
        const updatedPayment = await Payment.findOneAndUpdate(
          {reference: data.reference},
          {status: 'success', paidAt: new Date()},
          {new: true}
        )

        //Update Transaction
        const transaction = await TransactionService.updateTransaction(payment.transactionId, {status: 'success'}, payment.userId)

        //Update User Balance
        const user = await User.findById(payment.userId)
        if(!user) {
          logger.error('user not found')
          throw new AppError('user not found', 404)
        }
        user.wallet.balance += data.amount / 100
        await user.save()

        //Emit Event 
        eventBus.emit(EVENTS.PAYMENT_SUCCESS, {
          payment: updatedPayment,
          transaction,
          providerData: data
        })

        logger.info('Webhook processed successfully');
        return {status: 'success', message: 'Webhook processed successfully'}
      } 


      logger.error(`Invalid webhook event: ${event}`);
      return {status: 'error', message: 'Invalid webhook event'}
    
  }

  verifyWebhookSignature(payload, signature, rawBody) {
    // Paystack signs with your SECRET KEY, not a separate webhook secret. The
    // previous code required PAYSTACK_WEBHOOK_SECRET and returned false when it
    // was unset — silently rejecting every legitimate webhook.
    const signingKey = this.secret_key 
    if (!signingKey || !signature) return false;

    try {
      // Sign the RAW bytes Paystack sent. Re-serialising the parsed body with
      // JSON.stringify() is not byte-identical to the original payload (key
      // order, unicode escaping, whitespace), so the HMAC would not match.
      // app.js captures the raw buffer on req.rawBody for exactly this reason;
      // stringify is only a last-resort fallback.
      const body = rawBody

      const hash = crypto.createHmac('sha512', signingKey).update(body).digest('hex');

      // Constant-time comparison — a plain === leaks timing information that
      // can be used to forge a signature byte by byte.
      const a = Buffer.from(hash, 'utf8');
      const b = Buffer.from(String(signature), 'utf8');
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch (error) {
      logger.error('Webhook signature verification error:', error);
      return false;
    }
  }

  generateReference() {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 10).toUpperCase();
    return `VTN-${timestamp}-${random}`;
  }
}

module.exports = new PayStackService();

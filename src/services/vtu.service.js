require('dotenv').config();
const generateRequestID = require('../utils/generateRequest_id');
const Transaction = require('../models/Transaction.model');
const notificationService = require('../services/notification.service');
const TransactionService = require('../services/transaction.service')
const User = require('../models/User.model');
const AppError = require('../utils/AppError');
const eventBus = require('../events/eventsBus');
const axios = require('axios');
const RedisCache = require('../cache/redis_cache');
const logger = require('../utils/logger');

class VtuService {
    
    constructor() {
        this.base_url = 'https://sandbox.vtpass.com/api';
        this.secret_key = process.env.VTPASS_SECRET_KEY || 'your-secret-key';
        this.public_key = process.env.VTPASS_PUBLIC_KEY || 'your-public-key';
        this.api_key = process.env.VTPASS_API_KEY || 'your-api-key';
        this.request_id = generateRequestID();
    }

    //--------------SAVE TRANSACTION--------------//

    async saveTransactionToDB(transactionData, req) {
        const response = await TransactionService.createTransaction({
            type: transactionData.type,
            status: transactionData.status,
            currency: transactionData.currency,
            paidAt: transactionData.paidAt,
            createdAt: transactionData.createdAt,
            paymentMethod: transactionData.channel,
            fee: Number(transactionData.fees) / 100 || 0,
            transactionReference: transactionData.reference,
            user: req.user._id
        }, req)
    }

    //--------------VTPASS BUY AIRTIME--------------//

    async Vtpass_buy_airtime(data, req) {
        try {
            const user = await User.findById(req.user._id);
            const userAmount = user.wallet.balance

            
            // console.log(transactions)


            const { phone, amount, serviceID } = data;

            //amount check
            if (amount > userAmount) throw new Error('Insufficient balance')

                //Api call
                const response = await axios.post(`${this.base_url}/pay`, {
                    phone,
                    amount,
                    serviceID,
                    request_id: this.request_id
                }, {
                    headers: {
                        'Content-Type': 'application/json',
                        'api-key': `${this.api_key}`,
                        'secret-key': `${this.secret_key}`
                    }
                });
                const responseData = response.data;
            
                //Response validation
            if(responseData.content?.WrongBillersCode) throw new AppError(responseData.content.error, 400)
            if(responseData.content?.error) throw new AppError(responseData.content.error, 400)

                // if(!responseData.ok) throw new AppError('Transaction failed', 400)

                //Save Transaction to DB
            const transaction = await this.saveTransactionToDB(responseData, req)
            const transactions = await Transaction.findOne(user._id)
             await notificationService.createNotification(transactions._id, user._id)


            //Emit Event to create notification
            eventBus.emitSafe('airtime.purchase', { transaction, user });
            // console.log(user)


            //Deduct amount from user wallet
            user.wallet.balance = userAmount - amount

            //Save user
            await user.save()

          
            return responseData
        } catch (err) {
            throw new Error(err.message)
        }
    }

    //--------------VTPASS BUY DATA--------------//

    async Vtpass_buy_data(data, req) {
        try {
            const user = await User.findById(req.user._id);
            const userAmount = user.wallet.balance



            const { BillersCode, amount, serviceID, variation_code, phone } = data;

            if (amount > userAmount) throw new Error('Insufficient balance')

            const response = await fetch(`${this.base_url}/pay`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'api-key': `${this.api_key}`,
                    'secret-key': `${this.secret_key}`
                },
                body: JSON.stringify({ BillersCode, amount, serviceID, request_id: this.request_id, variation_code, phone })
            })
            const responseData = await response.json();

            const transaction = await this.saveTransactionToDB(responseData, req)
             await notificationService.createNotification(transaction._id, user._id)
            console.log(transaction)

            if(user.wallet.balance < amount) throw new AppError('Insufficient balance', 400)

            user.wallet.balance = userAmount - amount

            await user.save()
            return responseData
        } catch (err) {
            throw new Error(err.message)
        }
    }

    //--------------VTPASS DATA PLANS--------------//
    async Vtpass_vtu_get(data) {
        try {
            const { serviceID } = data;
            const response = await fetch(`${this.base_url}/service-variations?serviceID=${serviceID}`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'api-key': `${this.api_key}`,
                    'public-key': `${this.public_key}`
                }
            });
            const responseData = await response.json();

            //Cache data 
            const cache = await RedisCache.retrieve(responseData, serviceID)
            if (!cache) {
                await RedisCache.set(responseData, serviceID)
                logger.info(`Cache set for serviceID ${serviceID}: ${JSON.stringify(responseData)}`);
                return responseData
            }

            logger.info(`Cache hit for serviceID ${serviceID}`);
            return cache
        } catch (err) {
            throw new Error(err.message)
        }
    }

    
    //--------------VTPASS IKEJA ELECTRIC--------------//

    async vtpass_verify_meter_number(data, res) {
        try {
            const { billersCode, serviceID, type } = data
            const response = await fetch(`${this.base_url}/merchant-verify`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'api-key': `${this.api_key}`,
                    'secret-key': `${this.secret_key}`
                },
                body: JSON.stringify({ billersCode, serviceID, type })
            });
            const responseData = await response.json();
            // console.log(responseData)
            
            if(responseData.content?.WrongBillersCode) return res.status(400).json({message: responseData.content.error})
                if(responseData.content?.error) return res.status(400).json({message: responseData.content.error})
            return responseData
        } catch (err) {
            throw new Error(err.message)
        }
    }

    async Vtpass_by_ikeja_electric(data, req) {
        try {
            const user = await User.findById(req.user._id);
            const {request_id, variation_code, billersCode, amount, phone, serviceID} = data
            const response = await fetch(`${this.base_url}/pay`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'api-key': `${this.api_key}`,
                    'secret-key': `${this.secret_key}`
                },
                body: JSON.stringify({ request_id, variation_code, billersCode, amount, phone, serviceID })
            });
            const responseData = await response.json();
            // console.log(responseData)

              if(responseData.content?.WrongBillersCode) return res.status(400).json({message: responseData.content.error})
                if(responseData.content?.error) return res.status(400).json({message: responseData.content.error})

             const transaction = await this.saveTransactionToDB(responseData, req)
            //  console.log(transaction)
            const notification = await notificationService.createNotification(transaction._id, user._id)
             if(user.wallet.balance < amount) throw new AppError('Insufficient balance', 400)
            // if(user.wallet.balance < amount) return res.status(400).json({message: 'Insufficient balance'})

            user.wallet.balance = user.wallet.balance - amount
            await user.save()
            return responseData
        } catch (err) {
            throw new Error(err.message)
        }
    }

}

module.exports = new VtuService();
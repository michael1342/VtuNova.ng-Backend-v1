const { Worker } = require("bullmq");
const emailService = require("../services/email.service");
const logger = require("../utils/logger");
const User = require('../models/User.model');

require("dotenv").config();

console.log("emailWorker.js loaded");

const emailWorker = new Worker(
  "emailQueue",
  async (job) => {
    logger.info(`[email-worker] Processing job: ${job.name} (id=${job.id})`);

    switch (job.name) {
      case 'purchaseReceipt': {
        const { transaction, status, event, eventId } = job.data;
        if (!['success', 'failed'].includes(status)) break;
        const user = await User.findById(job.data.userId).select('email firstName lastName wallet');
        if (!user?.email) break;
        await emailService.send(status === 'success' ? 'transactionSuccessful' : 'transactionFailed',
          user.email, {
            fullName: `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'there',
            service: transaction.product_name || transaction.service || transaction.type,
            network: transaction.serviceID || transaction.provider,
            recipient: transaction.recipient || transaction.billersCode || transaction.phone,
            amount: transaction.amount,
            reference: transaction.requestId || transaction.transactionReference,
            purchasedCode: transaction.purchasedCode,
            walletState: transaction.walletState,
            newBalance: user.wallet?.balance,
            transactionId: transaction._id,
            time: new Date(transaction.settledAt || Date.now()).toLocaleString('en-GB', { timeZone: 'Africa/Lagos' }),
          }, { triggeredBy: event, dedupeKey: eventId, relatedUser: user._id });
        break;
      }
      case "loginAlert": {
        await emailService.send(
          "loginAlert",
          job.data.email,
          {
            fullName: job.data.fullName || "there",
            time: new Date().toLocaleString("en-GB", {
              dateStyle: "medium",
              timeStyle: "short",
              timeZone: "Africa/Lagos",
            }),
            ipAddress: job.data.ip,
            device: job.data.device,
          },
          {
            triggeredBy: "user.login",
            relatedUser: job.data.userId,
          }
        );
        break;
      }

      default: {
        logger.warn(`[email-worker] Unhandled job name: ${job.name}`);
        break;
      }
    }
  },
  {
    connection: {
      host: process.env.REDIS_HOST,
      port: Number(process.env.REDIS_PORT),
      password: process.env.REDIS_PASSWORD ,
    },
    concurrency: 5,
  }
);

emailWorker.on("completed", (job) => {
  logger.info(`[email-worker] Job ${job.id} completed`);
});

emailWorker.on("failed", (job, error) => {
  logger.error(`[email-worker] Job ${job?.id} failed:`, error.message);
});

emailWorker.on('error', (err) => {
  logger.error('Email worker error', { errorName: err.name, code: err.code });
});

module.exports = emailWorker;

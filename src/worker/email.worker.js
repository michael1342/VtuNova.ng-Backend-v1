const { Worker } = require("bullmq");
const emailService = require("../services/email.service");
const logger = require("../utils/logger");

require("dotenv").config();

console.log("emailWorker.js loaded");

const emailWorker = new Worker(
  "emailQueue",
  async (job) => {
    logger.info(`[email-worker] Processing job: ${job.name} (id=${job.id})`);

    switch (job.name) {
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

module.exports = emailWorker;
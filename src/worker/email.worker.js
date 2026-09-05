const { Worker } = require("bullmq");
const emailService = require("../services/email.service");
const logger = require("../utils/logger");

require("dotenv").config();

console.log("emailWorker.js loaded");

const emailWorker = new Worker(
  "emailQueue",
  async (job) => {
    // console.log(`Processing job: ${job.name}`);
    logger.info(`Processing job: ${job.name}`);

    if (job.name === "loginAlert") {
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
    }
  },
  {
    connection: {
      host: process.env.REDIS_HOST,
      port: Number(process.env.REDIS_PORT),
      password: process.env.REDIS_PASSWORD || undefined,
    },
  }
);

emailWorker.on("completed", (job) => {
  console.log(`Job ${job.id} completed`);
});

emailWorker.on("failed", (job, error) => {
  console.error(`Job ${job?.id} failed:`, error.message);
});
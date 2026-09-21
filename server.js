const registerEmailListeners = require('./src/listeners/email.listener.js');
const registerNotificationListeners = require('./src/listeners/notifications.listener.js');
const app = require('./src/app.js');
require('dotenv').config();
const PORT = process.env.PORT;
const connectDB = require('./src/config/database.js')
require('./src/worker/notification.worker.js')
require('./src/worker/email.worker.js')
const emailService = require('./src/services/email.service.js');
const logger = require('./src/utils/logger.js');





const startApp = async () => {
    try {
       await connectDB()
        await emailService.verify();
        // await notificationWorker();
        registerEmailListeners()
        registerNotificationListeners()

        //   NGROK SETUP
        const ngrok = require("@ngrok/ngrok");

        // async function forwardToApp() {
        //     const forwarder = await ngrok.forward({
        //         addr: "localhost:3000",
        //         authtoken_from_env: true,
        //         domain: "raven-chapped-cartload.ngrok-free.dev",
        //     });
        //     console.log(`Available at: ${forwarder.url()}`);
        // }

        forwardToApp();

        const server = app.listen(PORT, "0.0.0.0", () => {
            logger.info(`VtuNova Platform running on port ${PORT} [${process.env.NODE_ENV}]`);
            logger.info(`API Docs: http://localhost:${PORT}/api`);
        })


        const shutdown = (signal) => {
            logger.info(`${signal} received. Shutting down gracefully...`);
            server.close(() => {
                logger.info('HTTP server closed');
                process.exit(0);

            })
        };

        process.on('SIGTERM', () => shutdown('SIGTERM'));
        process.on('SIGINT', () => shutdown('SIGINT'));

        process.on('unhandledRejection', (err) => {
            logger.error('UNHANDLED REJECTION:', err);
            server.close(() => process.exit(1))
        });

    } catch (err) {
        console.error(" ❌ Failed to initialize application:", err);
        process.exit(1); // Stop the app if initialization fails
    }
}
startApp();
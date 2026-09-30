'use strict';

//--------------01. ENVIRONMENT--------------//
require('dotenv').config();

//--------------02. IMPORTS--------------//
const app = require('./src/app.js');
const connectDB = require('./src/config/database.js');
const logger = require('./src/utils/logger.js');
const { startWorker, shutdown } = require('./worker.js');

//--------------03. CONFIGURATION--------------//
const PORT = Number(process.env.PORT || 3000);
const HOST = '0.0.0.0';

let server;
let isShuttingDown = false;

//--------------04. GRACEFUL SHUTDOWN--------------//
async function shutdownApp(reason, exitCode = 0) {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info(`${reason}. Shutting down...`);

    const timeout = setTimeout(() => {
        logger.error('Shutdown timed out');
        process.exit(1);
    }, 15000);

    timeout.unref();

    // Stop accepting new HTTP requests immediately.
    // Convert the close result into a value to avoid an unhandled rejection
    // while the worker shutdown is running.
    const httpClosed = new Promise((resolve) => {
        if (!server?.listening) {
            resolve(null);
            return;
        }

        server.close((err) => resolve(err || null));
    });

    let finalExitCode = exitCode;

    try {
        // Uses the function imported from worker.js.
        await shutdown();
        logger.info('Workers stopped');
    } catch (err) {
        finalExitCode = 1;

        logger.error('Worker shutdown failed', {
            message: err?.message ?? String(err),
        });
    }

    const httpError = await httpClosed;

    if (httpError) {
        finalExitCode = 1;

        logger.error('HTTP server shutdown failed', {
            message: httpError.message,
        });
    } else {
        logger.info('HTTP server closed');
    }

    clearTimeout(timeout);
    process.exit(finalExitCode);
}

//--------------05. PROCESS SIGNALS AND FATAL ERRORS--------------//
process.once('SIGTERM', () => {
    void shutdownApp('SIGTERM received');
});

process.once('SIGINT', () => {
    void shutdownApp('SIGINT received');
});

process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', {
        message: reason?.message ?? String(reason),
    });

    void shutdownApp('Unhandled promise rejection', 1);
});

process.once('uncaughtException', (err) => {
    // Best-effort cleanup only; the process must exit after this error.
    logger.error('Uncaught exception', {
        message: err.message,
        code: err.code,
    });

    void shutdownApp('Uncaught exception', 1);
});

//--------------06. OPTIONAL LOCAL NGROK TUNNEL--------------//
async function startTunnel() {
    if (
        process.env.NODE_ENV === 'production' ||
        process.env.ENABLE_NGROK !== 'true'
    ) {
        return;
    }

    try {
        const ngrok = require('@ngrok/ngrok');

        const forwarder = await ngrok.forward({
            addr: `localhost:${PORT}`,
            authtoken_from_env: true,
            ...(process.env.NGROK_DOMAIN
                ? { domain: process.env.NGROK_DOMAIN }
                : {}),
        });

        logger.info(`Public URL: ${forwarder.url()}`);
    } catch (err) {
        // An optional tunnel failure does not stop the local server.
        logger.error('Failed to start ngrok', {
            message: err.message,
        });
    }
}

//--------------07. START APPLICATION--------------//
async function startApp() {
    try {
        if (
            !Number.isInteger(PORT) ||
            PORT < 1 ||
            PORT > 65535
        ) {
            throw new Error(
                'PORT must be an integer between 1 and 65535'
            );
        }

        await connectDB();

        if (isShuttingDown) return;

        await startWorker();

        if (isShuttingDown) return;

        await new Promise((resolve, reject) => {
            server = app.listen(PORT, HOST);

            server.once('error', reject);

            server.once('listening', () => {
                server.removeListener('error', reject);
                resolve();
            });
        });

        server.on('error', (err) => {
            logger.error('HTTP server error', {
                message: err.message,
                code: err.code,
            });

            void shutdownApp('HTTP server error', 1);
        });

        if (isShuttingDown) return;

        logger.info(
            `VTUNova running on port ${PORT} ` +
            `[${process.env.NODE_ENV || 'development'}]`
        );

        logger.info(
            `API Docs: http://localhost:${PORT}/api`
        );

        void startTunnel();
    } catch (err) {
        logger.error('Failed to initialize application', {
            message: err?.message ?? String(err),
            code: err?.code,
        });

        await shutdownApp('Startup failure', 1);
    }
}

void startApp();
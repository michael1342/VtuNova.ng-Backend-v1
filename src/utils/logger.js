const winston = require('winston');
const path = require('path');
const fs = require('fs');

require('dotenv').config();


/* ============================================================
   LOG DIRECTORY
============================================================ */

const logsDir = path.join(__dirname, '..', 'logs');

if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}


/* ============================================================
   FORMATS
============================================================ */

const consoleFormat = winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp({
        format: 'YYYY-MM-DD HH:mm:ss',
    }),
    winston.format.printf(({ timestamp, level, message, stack }) => {
        return `${timestamp} [${level}]: ${stack || message}`;
    })
);

const fileFormat = winston.format.combine(
    winston.format.timestamp({
        format: 'YYYY-MM-DD HH:mm:ss',
    }),
    winston.format.errors({ stack: true }),
    winston.format.json()
);


/* ============================================================
   LOGGER
============================================================ */

const logger = winston.createLogger({
    level:
        process.env.NODE_ENV === 'production'
            ? 'info'
            : 'debug',

    format: fileFormat,

    defaultMeta: {
        service: 'vtunova-api',
        environment: process.env.NODE_ENV || 'development',
    },

    transports: [

        // Console
        new winston.transports.Console({
            format: consoleFormat,
        }),

        // Errors only
        new winston.transports.File({
            filename: path.join(logsDir, 'error.log'),
            level: 'error',
        }),

        // All logs
        new winston.transports.File({
            filename: path.join(logsDir, 'combined.log'),
        }),
    ],

    // Uncaught exceptions
    exceptionHandlers: [
        new winston.transports.File({
            filename: path.join(logsDir, 'exceptions.log'),
        }),
    ],

    // Unhandled Promise rejections
    rejectionHandlers: [
        new winston.transports.File({
            filename: path.join(logsDir, 'rejections.log'),
        }),
    ],
});


module.exports = logger;
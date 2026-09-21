const logger = require('../utils/logger');
console.log('error middleware loaded');

/**
 * Central error handler. Every thrown/next()'d error ends up here and is
 * converted into the same JSON envelope the rest of the API uses.
 *
 * Mongoose and JWT throw their own error shapes, so we translate the common
 * ones into clean messages instead of leaking internals to the client.
 */
const handleCastError = (err) => ({
  message: `Invalid ${err.path}: ${err.value}`, statusCode: 400,
});
const handleDuplicate = (err) => ({
  message: `Duplicate value for field: "${Object.keys(err.keyValue || {})[0]}". Please use another value.`,
  statusCode: 409,
});
const handleValidation = (err) => ({
  message: `Validation failed: ${Object.values(err.errors).map((e) => e.message).join('. ')}`,
  statusCode: 400,
});

module.exports = (err, req, res, next) => {
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal Server Error';

  if (err.name === 'CastError')         ({ message, statusCode } = handleCastError(err));
  if (err.code === 11000)               ({ message, statusCode } = handleDuplicate(err));
  if (err.name === 'ValidationError')   ({ message, statusCode } = handleValidation(err));
  if (err.name === 'JsonWebTokenError') { message = 'Invalid token. Please log in again.'; statusCode = 401; }
  if (err.name === 'TokenExpiredError') { message = 'Your session has expired. Please log in again.'; statusCode = 401; }

  // Only 5xx are genuine server faults worth a stack trace in the logs.
  if (statusCode >= 500) logger.error(err.stack || message);

  res.status(statusCode).json({
    success: false,
    message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};
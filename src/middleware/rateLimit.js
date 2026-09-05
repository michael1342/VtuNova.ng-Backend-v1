const {rateLimit} = require('express-rate-limit')

 const AuthRate = rateLimit({
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 10, // limit each IP to 100 requests per windowMs
        standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
        legacyHeaders: false, // Disable the `X-RateLimit-*` headers
        skipSuccessfulRequests: true
    });
 const refreshRate = rateLimit({
        windowMs: 10 * 60 * 1000, // 15 minutes
        max: 5, // limit each IP to 100 requests per windowMs
        standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
        legacyHeaders: false, // Disable the `X-RateLimit-*` headers
        skipSuccessfulRequests: true
    });

    module.exports = {AuthRate, refreshRate}
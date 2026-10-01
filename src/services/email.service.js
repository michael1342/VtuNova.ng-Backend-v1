'use strict';

const nodemailer = require('nodemailer');
const { Resend } = require('resend');
const config = require('../config/email');
const { DeliveryError, classify } = require('../utils/email-errors');

class EmailService {
    constructor() {
        this.transporter = null;
        this.resend = null;
    }

    //--------------PUBLIC API: PERSIST INTENT, THEN ENQUEUE; NEVER SEND HERE--------------//
    send(templateName, to, data, meta = {}) {
        return require('../jobs/email.job').enqueue(templateName, to, data, meta);
    }

    // Compatibility entry point repairs queue state; it never calls a provider.
    retryFailed(batchSize) {
        return require('../jobs/email.job').recover(batchSize);
    }

    //--------------ONE PROVIDER CALL PER WORKER ATTEMPT--------------//
    async deliver(log, request) {
        try {
            if (!request.from) throw new DeliveryError('email_sender_missing');
            if (log.provider === 'resend') {
                if (!process.env.RESEND_API_KEY) throw new DeliveryError('resend_configuration_missing');
                if (!this.resend) {
                    this.resend = new Resend(process.env.RESEND_API_KEY, { baseUrl: 'https://api.resend.com' });
                    // SDK 6.31 logs raw API errors in development. Suppress that output.
                    this.resend.logError = () => {};
                }
                const result = await this.resend.emails.send(request, {
                    idempotencyKey: log.dedupeKey,
                    signal: AbortSignal.timeout(config.timeoutMs),
                });
                if (result.error) throw classify(result.error, 'resend', result.headers);
                if (!result.data?.id) throw new DeliveryError('provider_response_incomplete', { retryable: true, ambiguous: true });
                return { providerMessageId: result.data.id };
            }
            if (log.provider !== 'smtp') throw new DeliveryError('email_provider_invalid');
            if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
                throw new DeliveryError('smtp_configuration_missing');
            }
            if (!this.transporter) {
                this.transporter = nodemailer.createTransport({
                    host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587),
                    secure: Number(process.env.SMTP_PORT) === 465,
                    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
                    pool: true, maxConnections: 5, maxMessages: 100, maxRequeues: 0,
                    connectionTimeout: config.timeoutMs, greetingTimeout: config.timeoutMs,
                    socketTimeout: config.timeoutMs, logger: false, debug: false,
                });
            }
            const result = await this.transporter.sendMail({ ...request,
                messageId: '<' + log.dedupeKey + '@vtunova.email>', date: new Date(log.createdAt) });
            if (!result.accepted?.length) throw new DeliveryError('smtp_recipient_rejected');
            return { providerMessageId: result.messageId };
        } catch (error) {
            // Never switch providers after an ambiguous result.
            throw classify(error, log.provider);
        }
    }
}

module.exports = new EmailService();
module.exports.EmailService = EmailService;

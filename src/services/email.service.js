const nodemailer = require('nodemailer');
const EmailLog = require('../models/EmailLog.model');
const templates = require('../templates');
const logger = require('../utils/logger');
const { BRAND } = require('../templates/layout');
require('dotenv').config();

class EmailService {
    constructor() {
        this.transporter = null;
        this.isConfigured = false;
        this._init();
    }

    _init() {
        const { SMTP_HOST, SMTP_USER } = process.env;

        if (!SMTP_HOST || !SMTP_USER) {
            logger.warn('SMTP not configured — emails will be logged to console, not sent.');
            console.log('SMTP not configured — emails will be logged to console, not sent.');
            this.isConfigured = false;
            return;
        }

        this.transporter = nodemailer.createTransport({
            host: SMTP_HOST,
            port: Number(process.env.SMTP_PORT) || 587,
            secure: Number(process.env.SMTP_PORT) === 465, // true only for implicit-TLS port
            auth: { user: SMTP_USER, pass: process.env.SMTP_PASS },
            pool: true,
            maxConnections: 5,
            maxMessages: 100,
        });

        this.isConfigured = true;
        logger.info(`Email transport ready via ${SMTP_HOST}`);
    }
    async verify() {
        if (!this.isConfigured) return;
        try {
            await this.transporter.verify();
            logger.info('SMTP connection veried');
            return true;

        } catch (err) {
            logger.error(`SMTP verification failed : ${err.message}`);
            return false;
        }
    }

    async send(templateName, to, data, meta = {}) {
        //run email regex on receiver email
        if (!to || !/^\S+@\S+\.\S+$/.test(to)) {
            logger.warn(`Skipping email "${templateName}" — invalid recipient: ${to}`);
            return;
        }

        let rendered;
        try {
            rendered = templates.render(templateName, data);
        } catch (err) {
            logger.error(`Template render failed for "${templateName}": ${err.message}`);
            return;
        }

        let log;
        try {
            // log = await EmailLog.create({
            //     to,
            //     subject: rendered.subject,
            //     template: templateName,
            //     triggeredBy: meta.triggeredBy,
            //     dedupeKey: meta.dedupeKey,
            //     relatedCandidate: meta.relatedCandidate,
            //     relatedUser: meta.relatedUser,
            //     renderContext: data,
            //     status: 'queued',
            // });
        } catch (err) {
            if (err.code === 11000) {
                logger.debug(`Duplicate email suppressed: ${meta.dedupeKey}`);
                return;
            }
            logger.error(`Failed to create email log: ${err.message}`);
            // Still try to deliver even if logging failed — best effort.
            return this._deliver(null, to, rendered);
        }

        return this._deliver(null, to, rendered);
    }

    async _deliver(log, to, rendered) {
        if (log) await log.markSending().catch(() => { });
        if (!this.isConfigured) {
            logger.info(
                `\n──── EMAIL (dev, not sent) ────\n` +
                `To: ${to}\n` +
                `Subject: ${rendered.subject}\n` +
                `───────────────────────────────`
            );
            if (log) await log.markSent('dev-console').catch(() => { });
            return;
        }
        try {
            const info = await this.transporter.sendMail({
                from: `"${BRAND.name}" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
                to,
                subject: rendered.subject,
                text: rendered.text,
                html: rendered.html,
            });

            // if (log) await log.markSent(info.messageId).catch(() => { });
            logger.debug(`Email sent to ${to}: ${rendered.subject}`);

        } catch (err) {
            logger.error(`Email delivery failed to ${to}: ${err.message}`);
            // if (log) await log.markFailed(err.message).catch(() => { });
        }
    }

    async retryFailed(batchSize = 20) {
        const stuck = await EmailLog.find({
            status: 'failed',
            attempts: { $lt: this._maxAttempts() },
        })
            .sort({ lastAttemptAt: 1 })
            .limit(batchSize)
            .select('+renderContext');

        if (!stuck.length) return { retried: 0 };

        logger.info(`Retrying ${stuck.length} failed email(s)`);

        for (const log of stuck) {
            let rendered;
            try {
                rendered = templates.render(log.template, log.renderContext || {});
            } catch (err) {
                await log.markFailed(`Re-render failed: ${err.message}`).catch(() => { });
                continue;
            }
            await this._deliver(log, log.to, rendered);
        }

        return { retried: stuck.length };
    }
    ///
    _maxAttempts() {
        return Number(process.env.EMAIL_MAX_ATTEMPTS) || 3;
    }

}

module.exports = new EmailService();
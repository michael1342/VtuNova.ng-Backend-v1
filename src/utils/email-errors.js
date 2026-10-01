'use strict';

//--------------ALLOWLISTED ERRORS: NO RAW PROVIDER MESSAGES OR RESPONSES--------------//
class DeliveryError extends Error {
    constructor(code, { retryable = false, ambiguous = false, statusCode, retryAfterMs = 0 } = {}) {
        super(code);
        this.name = 'DeliveryError';
        Object.assign(this, { code, retryable, ambiguous, statusCode, retryAfterMs });
    }
}

function retryAfter(headers, now = Date.now()) {
    const raw = headers?.get?.('retry-after') ?? headers?.['retry-after'];
    if (raw == null) return 0;
    const seconds = Number(raw);
    const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(raw) - now;
    return Number.isFinite(ms) ? Math.max(0, ms) : 0;
}

function classify(error, provider, headers) {
    if (error instanceof DeliveryError) return error;
    const status = Number(error?.statusCode || error?.status || error?.responseCode) || undefined;
    const guidance = retryAfter(headers || error?.headers);
    if (provider === 'smtp') {
        if (status >= 400 && status < 500) return new DeliveryError('smtp_temporary_rejection', { retryable: true, statusCode: status });
        if (status >= 500 || ['EAUTH', 'EENVELOPE', 'EMESSAGE'].includes(error?.code)) {
            return new DeliveryError('smtp_permanent_rejection', { statusCode: status });
        }
        if (['EDNS', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'].includes(error?.code)) {
            return new DeliveryError('smtp_connection_failed', { retryable: true });
        }
        return new DeliveryError('smtp_acceptance_unknown', { ambiguous: true });
    }
    if (error?.name === 'concurrent_idempotent_requests') {
        return new DeliveryError('concurrent_idempotent_requests', { retryable: true, ambiguous: true, retryAfterMs: guidance });
    }
    if (['daily_quota_exceeded', 'monthly_quota_exceeded'].includes(error?.name)) {
        return new DeliveryError('provider_quota_exceeded', { statusCode: status });
    }
    if (status === 429 || error?.name === 'rate_limit_exceeded') {
        return new DeliveryError('rate_limited', { retryable: true, statusCode: 429, retryAfterMs: guidance });
    }
    if (status === 408 || [500, 502, 503, 504].includes(status) || !status && ['application_error', 'Error', 'TypeError', 'AbortError', 'TimeoutError'].includes(error?.name)
        || ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'].includes(error?.code)) {
        return new DeliveryError('provider_temporarily_unavailable', {
            retryable: true, ambiguous: true, statusCode: status, retryAfterMs: guidance,
        });
    }
    return new DeliveryError('provider_permanent_rejection', { statusCode: status });
}

function failure(error, at = new Date()) {
    return { code: error.code, retryable: error.retryable, ambiguous: error.ambiguous,
        statusCode: error.statusCode, at };
}

function backoff(attemptsMade, type, error, job) {
    const base = job?.opts?.backoff?.delay || 10000;
    return Math.max(base * 2 ** Math.max(0, attemptsMade - 1), error?.retryAfterMs || 0);
}

module.exports = { DeliveryError, classify, failure, retryAfter, backoff };

# Email delivery and recovery

Email follows the existing event bus → listeners → emailQueue → jobs → emailWorker → EmailService flow. The public CommonJS API remains send(templateName, to, data, meta = {}); it now persists an intent and returns its email ID, deterministic job ID, and current state. It does not report inbox delivery.

## Setup

Use Node 20 or later and npm ci. This implementation uses the already installed official resend 6.31.0 and BullMQ 6.3.4 SDKs. SMTP still uses Nodemailer.

Merge .env.example into your existing environment. Required email settings:

- EMAIL_PROVIDER=resend, RESEND_API_KEY, and RESEND_FROM (a mailbox on the verified domain).
- EMAIL_PAYLOAD_ENCRYPTION_KEY: base64 encoding of 32 random bytes. Generate a key once in your secret manager or locally using the command below; store it securely and use the same key on every API/worker process. Never commit the key.
- Existing MONGODB_URI, REDIS_HOST, REDIS_PORT, REDIS_PASSWORD, and REDIS_URL. The host/port configuration is reused for BullMQ; the existing node-redis client uses REDIS_URL for live OTP checks. Both must address the same Redis database.
- Existing APP_NAME, APP_URL, SUPPORT_EMAIL, OTP_SECRET, and OTP_EXPIRES_IN continue to control branding/credentials.

    node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"

Defaults and bounds are validated in src/config/email.js: EMAIL_MAX_ATTEMPTS=3 (1–10 total), EMAIL_BACKOFF_MS=10000 (1 second–1 hour), EMAIL_TIMEOUT_MS=30000 (1–60 seconds), EMAIL_CONCURRENCY=5 (1–20), EMAIL_RECOVERY_INTERVAL_MS=60000 (10 seconds–1 hour), and EMAIL_RECOVERY_BATCH_SIZE=50 (1–200).

EMAIL_LOG_RETENTION_DAYS=180 (2–365), EMAIL_PAYLOAD_RETENTION_HOURS=24 (1–24), EMAIL_FAILED_JOB_RETENTION_DAYS=7 (1–30), and EMAIL_FAILED_JOB_RETENTION_COUNT=1000 (1–10,000) bound retained data.

For SMTP, set EMAIL_PROVIDER=smtp, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and SMTP_FROM (defaults to SMTP_USER). Port 465 uses implicit TLS; port 587 uses SMTP/STARTTLS. Provider and sender are fixed when the intent is created. Changing configuration affects new intents, not retries of existing ones.

Missing encryption configuration prevents worker startup. Missing provider credentials/sender and an unverified Resend domain are failures, never simulated success. Do not enqueue production OTPs while domain verification is pending: they may fail permanently or expire. After fixing configuration, request a new credential/event instead of reviving a stale security email.

## Start and stop

npm start starts the API and its existing embedded workers, including email and recovery. npm run worker starts the existing standalone worker entry point. Both upsert the same persistent email-recovery scheduler on emailQueue. No separate cron process or retry loop is required. Multiple worker processes may run against the same queues.

Startup creates EmailLog indexes before registering email listeners. Ensure the database account can create indexes. The existing emailLog model/collection is retained; a partial unique dedupe index permits old records without keys. Old untracked BullMQ email jobs are rejected with email_legacy_job_requires_review: inspect/drain them before rollout, and recreate only confirmed unsent events with stable IDs. Historical EmailLog documents without payload/identity are not automatically sent or TTL-deleted.

SIGINT/SIGTERM first drain HTTP producers, then workers, before closing queues, SMTP, Redis and MongoDB. The API allows three minutes for graceful shutdown. The recovery scheduler remains in Redis across restarts. Configure Redis persistence and a no-eviction policy for job durability. MongoDB writes use majority acknowledgement.

## Identity, retries and recovery

Every caller must provide meta.dedupeKey or meta.eventId, stable for the logical event. The stored SHA-256 key includes template and normalized recipient. Purchase receipt aliases share transaction ID and outcome; welcome, wallet, and withdrawal events use their durable entity/reference. Login/password-change events use the persisted timestamp or a caller-supplied event ID. Producers replaying an event without a durable entity timestamp must retain its event ID. Duplicate suppression lasts as long as the EmailLog record (180 days by default).

For credential emails, provide meta.expiresAt and meta.credential. OtpService now supplies a unique credential ID, purpose, and the actual Redis credential expiry, and awaits successful intent persistence. Password-reset links use the user's persisted token hash and passwordResetExpires. The existing password-reset OTP event is now supported by the branded template. Credential generation is never part of a retry. Before each send, the worker checks current credential identity and validity, rejecting consumed, replaced, or expired credentials. Credential invalidation during an already in-flight provider request cannot recall that email.

States are queued, sending, retrying, accepted, failed, and expired. Accepted means only provider request acceptance. There is no delivery webhook or inbox-delivery claim. Attempts are counted durably immediately before the provider call; a crash at that boundary may conservatively consume an attempt.

BullMQ owns automatic retries. The default delays are 10 seconds and 20 seconds, increased when Retry-After requires it. Network ambiguity, HTTP 408, rate limiting, concurrent idempotent requests, and server errors can retry. Invalid credentials, domain verification, invalid recipients, invalid request/idempotency conflicts, and exhausted daily/monthly quotas stop. Nodemailer's internal pool requeues are disabled.

Every retry decrypts the original rendered request; it never re-renders with new times, branding, balances or codes. Resend receives the same payload and idempotency key through HTTPS. No provider failover occurs. The worker stops Resend replay at 23 hours 55 minutes from the first attempt, leaving a five-minute margin inside the documented 24-hour idempotency window. Earlier payload/credential expiry also stops it.

The recovery job atomically leases at most EMAIL_RECOVERY_BATCH_SIZE records per sweep, inspects queue state, and leaves active/waiting/delayed work to BullMQ. It re-enqueues missing jobs with the same ID, remaining MongoDB attempt allowance, and persisted delay. Failed/completed jobs without an outcome receipt are terminalized, not resurrected. MongoDB attempt counts also guard against manual BullMQ retries or Redis loss resetting the delivery budget. The same Mongo lease protects delivery and queue repair.

Before recording provider acceptance in MongoDB, the worker also stores a small outcome receipt in the BullMQ job. If MongoDB then fails, retries/recovery apply that receipt without another provider call, even after expiry or exhaustion. Retry receipts similarly preserve Retry-After if the MongoDB retry update fails. If both outcome stores fail, the prior sending marker remains ambiguous: Resend may replay only within its window and remaining budget; SMTP stops for review. Monitor needsReview records and the Resend dashboard. Never generate a replacement key solely to bypass ambiguity.

SMTP has no general provider-side deduplication guarantee. A stable Message-ID is only a hint. Explicit temporary rejections and pre-connection DNS/refusal errors can retry; ambiguous connection loss stops for review. Acceptance followed by a crash can still leave an uncertain outcome, and manual replay can duplicate delivery. This is not exactly-once SMTP delivery.

The event bus itself is in memory. Recovery begins once the EmailLog intent exists; it cannot reconstruct an event lost before persistence or replay unrelated business transactions. Credential producers await intent persistence; account producers now await listener completion. A transactional business-event outbox would be a separate change.

## Sensitive data and retention

Only the immutable provider request and credential reference are AES-256-GCM encrypted in MongoDB, with the dedupe key as authenticated associated data. Raw user objects, account password hashes, render contexts, API keys and SMTP passwords are not stored. The rendered body is necessary for byte-consistent retries; it is never written to Redis or logs. Metadata (recipient, sender, subject, provider, IDs, status, counts, timestamps, sanitized error category/HTTP code) stays queryable. Failure messages and provider response bodies are never persisted or logged; raw Resend SDK development error logging is disabled.

Payloads are deleted on terminal status. Their maximum lifetime is the earlier of credential expiry and EMAIL_PAYLOAD_RETENTION_HOURS from intent creation. A bounded sweep physically scrubs expired payloads, including delayed jobs; cleanup can lag while workers are offline or under backlog, but sends check expiry immediately. MongoDB's purgeAt TTL removes entire records after the configured log retention. TTL deletion is asynchronous. Retain the encryption key until all outstanding payloads are terminal/expired; this version does not implement multi-key rotation. Database/backup access and backup retention must match your privacy policy.

Failed BullMQ jobs retain bounded age and count for investigation; automatic age cleanup is lazy when jobs settle. Completed jobs retain up to 1 day/1,000 jobs. Redis stores only the EmailLog ID and a sanitized outcome receipt, never an OTP, link, or email body. Existing Redis credential storage continues to contain the credential hash.

## Test and manual verification

Run npm run test:email, npm test, and npm run build. Email tests mock all provider calls and infrastructure; no email is sent. They exercise success, permanent/transient outcomes, duplicate events, expiry, ciphertext authentication, lost enqueue, leases, remaining budgets, and provider-acceptance/database-failure recovery. Existing real infrastructure tests require explicitly isolated VTU_TEST_MONGODB_URI/VTU_TEST_REDIS_URL endpoints; never point them at production.

After Resend marks the domain verified, fill in the real configuration, start the worker, and run:

    npm run email:manual -- your-own-inbox@example.com verification-2026-10-01-1

This intentionally enqueues one real welcome email for the worker. Inspect emaillogs for triggeredBy: "email.manual-test" and the returned email ID. Expect accepted, an attempt count, and a Resend providerMessageId; check the Resend dashboard and your inbox separately. Running the identical command again must reuse the same log/job and cause no second provider submission. Use a new event ID only for a genuinely new test.

## Official references checked

- [Resend Node.js SDK](https://resend.com/docs/send-with-nodejs)
- [Resend idempotency keys and 24-hour window](https://resend.com/docs/dashboard/emails/idempotency-keys)
- [Resend error categories](https://resend.com/docs/api-reference/errors)
- [Resend usage limits and retry headers](https://resend.com/docs/api-reference/rate-limit)
- [BullMQ retry/backoff behavior](https://docs.bullmq.io/guide/retrying-failing-jobs)
- [BullMQ unrecoverable failures](https://docs.bullmq.io/patterns/stop-retrying-jobs)
- [BullMQ persistent job schedulers](https://docs.bullmq.io/guide/job-schedulers)

The installed SDK source was also checked for CommonJS exports, AbortSignal forwarding, response headers, absence of Resend automatic retries, BullMQ attempt handling, and job data updates.

## Changed files and validation

- Delivery: src/services/email.service.js, src/models/EmailLog.model.js, src/config/email.js, src/utils/email-payload.js, src/utils/email-errors.js.
- Queue and recovery: src/queue/email.queue.js, src/jobs/email.job.js, src/jobs/email.scheduler.js, src/worker/email.worker.js.
- Callers and credentials: src/listeners/email.listener.js, src/events/eventsBus.js, src/services/auth.service.js, src/services/otp.service.js, src/services/email-credential.service.js, src/templates/index.js.
- Startup and setup: worker.js, server.js, package.json, package-lock.json, .env.example, scripts/email-manual.js, this document. Existing Resend dependency changes were retained; no real credentials were edited.
- Tests: test/email.test.js, test/reconciliation-infrastructure.test.js, test/vtu.test.js. The existing notification assertions now use the retrieval formatter, consistent with their unchanged production code.

Validation: 31 email tests; full suite 80 passed, 0 failed, 2 optional infrastructure tests skipped (no isolated test endpoints configured). Build syntax/import validation passed. Provider calls were mocked; no real email was sent. Real MongoDB/Redis atomicity, provider acceptance, domain verification and inbox delivery have not been exercised against live services.

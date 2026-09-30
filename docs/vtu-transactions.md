# VTU Purchases and Background Reconciliation

## Wallet Rules

The existing version 3 purchase flow is preserved. Amounts are whole naira.
`wallet.balance` is the total balance, `wallet.reserved` is the pending hold,
and available funds are `balance - reserved`.

- New purchases reserve funds and create the pending transaction in one MongoDB transaction.
- Confirmed success debits the balance and releases the hold in one commit.
- Confirmed failure releases the hold without crediting the balance (`walletState: released`).
- Uncertain responses and network errors keep the purchase pending and the hold intact.
- Version 2 purchases already deducted balance: success never debits again; failure refunds once.

Version 1 records are excluded from reconciliation. No historical flow versions,
wallet balances, provider mappings, or purchase endpoints are rewritten.
Provider calls are outside MongoDB transaction callbacks. Terminal settlement
and the wallet update commit together, with status/wallet-state guards and
MongoDB write-conflict retries protecting competing settlement paths.

## Startup

Run the existing API as usual, and run this separate, supervised process:

```sh
npm run worker:reconciliation
```

`worker.js` connects MongoDB, registers the existing event listeners, upserts the
reconciliation scheduler, then starts the reconciliation, notification, and email
workers. The API's existing notification/email workers can run alongside these.
`npm start` alone does **not** run reconciliation. No HTTP endpoint triggers it.

The worker uses the API's existing `MONGODB_URI`, `REDIS_HOST`, `REDIS_PORT`,
`REDIS_PASSWORD`, provider credentials, and SMTP settings. `REDIS_URL` still
configures the application's separate cache client. Ensure queue settings point
to the same Redis instance/database for every process. MongoDB must support
transactions (a replica set or sharded cluster).

Look for `Purchase reconciliation scheduler registered` and
`Purchase reconciliation worker running`. Each job logs `sweep started`, followed
by `sweep completed` or `sweep failed`. JSON logs in `src/logs/combined.log` contain
transaction ID, provider, check attempt, outcome, next check, and review escalation.
No provider credentials, authorization headers, response bodies, or Axios objects
are logged by reconciliation. Alert on failed/stalled sweeps and overdue checks.
An idle sweep reports zero checked; that is expected when no purchases are due.

`SIGINT`/`SIGTERM` stop new sweep work and await the active sweep, then drain delivery
workers, close queues and SMTP, and disconnect Redis/MongoDB. Give the supervisor
enough grace time for a whole batch (several minutes when providers time out).
A forced termination is recovered through expiring purchase leases. Scheduler
metadata intentionally survives shutdown so other worker instances can continue.

## Scheduling and Configuration

BullMQ **6.3.4**, already installed, supplies `upsertJobScheduler` and
`setGlobalConcurrency(1)`. The stable scheduler ID is `pending-purchase-sweep`
in `purchaseReconciliationQueue`. Re-registering it updates the same schedule.
Global concurrency limits active sweep jobs across worker processes. BullMQ
creates the next scheduled job when the previous one starts, so missed intervals
do not create an unbounded backlog. Completed/failed history is capped at 100 each;
there are no extra sweep retries. See the official [scheduler documentation](https://docs.bullmq.io/guide/job-schedulers/)
and [global concurrency documentation](https://docs.bullmq.io/guide/queues/global-concurrency).

Optional settings are listed in `.env.reconciliation.example`:

- `VTU_RECONCILE_SWEEP_MS=60000`: sweep interval, 1 second to 1 hour.
- `VTU_RECONCILE_CHECK_MS=300000`: normal per-purchase interval, 1 minute to 24 hours.
- `VTU_RECONCILE_REVIEW_AFTER_MS=86400000`: review threshold for new purchases and
  records without `reviewAfter`, 1 minute to 30 days. Existing stored deadlines remain intact.
- `VTU_RECONCILE_REVIEW_MS=3600000`: review-case interval, 1 minute to 7 days.
- `VTU_RECONCILE_LEASE_MS=180000`: claim lifetime, 3 to 15 minutes. The minimum
  covers two 15-second Quickteller calls and the driver's normal settlement retry window.
- `VTU_RECONCILE_BATCH_SIZE=50`: maximum purchases per sweep, 2 to 200.
- `VTU_RECONCILE_CONCURRENCY=3`: maximum simultaneous status checks per sweep, 1 to 10.

Invalid settings fail at startup. Configure the same values on all workers.
Review checks should be slower than normal checks. These are operating defaults,
not claimed provider quotas. Confirm account-specific VTpass/Quickteller limits
and lower concurrency/batch size or increase intervals accordingly. `Retry-After`
on a failed status request delays that purchase's next check. This is not an
account-wide rate limiter shared with foreground purchases.

## Recovery and Review

MongoDB is the authoritative backlog. Every sweep claims due pending version 2/3
purchases with reserved wallet state. It alternates normal and review lanes,
borrowing unused capacity so neither lane starves under sustained load.
Missing/null `nextCheckAt` is treated as due, including old stranded review cases.

Each atomic claim stores a random lease token, expiry, and incremented attempt
count. Queries always use the **original provider and original request ID**:
VTpass `/requery`, or Quickteller `GET /Transactions`. Reconciliation never calls
a purchase endpoint, generates a replacement request ID, or switches providers.

The existing classifier and settlement method process the result. A pending result
or failed check reschedules and releases the lease in a single token/expiry-guarded
write. Pending metadata and terminal settlement also reject stale leases. An
expired claim is available to a new worker; an old worker cannot overwrite its
lease or schedule. Infrastructure and provider failures are isolated per purchase,
then reported as a failed sweep after other checks finish.

At the review threshold, unresolved purchases remain pending with funds held,
gain `needsReview: true`, and continue hourly checks by default. The escalation is
logged only when that persisted flag changes. There is no age/attempt-based refund,
failure, release, or permanent cutoff. Confirmed settlement clears review and
scheduling fields. Any administrative resolution must be explicitly authorized,
audited, and atomic; this change adds no administrative settlement endpoint.

## Notifications

The path is service -> event bus -> listeners -> queue -> worker. Pending is emitted
after reservation commits; success/failed is emitted only by the caller whose
settlement commits. Repeated pending status checks emit nothing. Events remain
`AIRTIME_PURCHASE`, `DATA_PURCHASE`, `ELECTRICITY_PURCHASE`, and `CABLE_TV_PURCHASE`
(for stored cable purchases; no new cable purchase endpoint was added).
The payload includes `{ transaction, user, status, eventId }`; the stable event ID
is `<transaction MongoDB id>-<status>`. No generic settlement events are introduced.

All purchase transitions queue `createNotification` with status, amount, wallet
state, and formatted title/message. Pending says processing. Failed version 3
receipts say the hold was released; legacy version 2 receipts say refunded.
Terminal transitions also queue `purchaseReceipt` for email, with explicit status
checks in both listener and worker. Existing branded layouts are reused unchanged.
The event bus now awaits listener enqueue promises, which lets graceful shutdown
drain before queues close.

In-app notifications use a MongoDB unique `eventId` index and atomic upserts;
duplicate queue deliveries are suppressed even after the BullMQ job is removed,
while the notification record is retained. Deleting that record removes this
deduplication history. Historical notifications without event IDs remain valid.

Delivery is still **best effort**, not a durable outbox. A crash between purchase
commit and event enqueue can lose a notification. Email's existing service has no
persistent delivery deduplication and catches SMTP errors internally; email queue
replay after removal can resend, and SMTP delivery failures are not guaranteed to
retry. This change does not claim exactly-once email delivery or durable event delivery.

## Schema Deployment

Added schema support is limited to `released` wallet state, version 3 purchase
validation, and notification `eventId` plus its partial unique index. The existing
unique `{ provider, requestId }` index and both due-status indexes are retained.
`wallet.reserved` and reconciliation fields already existed. No balance migration
or record relabeling is needed; null schedules recover through the sweep query.

Build indexes before enabling purchases/workers, especially with `autoIndex: false`:

```sh
node scripts/migrate-purchase-reconciliation.js
node scripts/migrate-purchase-reconciliation.js --apply
```

The first command audits duplicate identities and previews the required indexes.
The second creates missing indexes using `createIndexes`, never `syncIndexes`.
Duplicate identities or index conflicts require investigation, not record deletion
or inferred refunds. Neither command modifies production balances or rewrites
transactions. These commands are provided for deployment and were not run here.

## Verification

```sh
npm test
npm run build
```

Offline tests cover reservation, both settlement versions, duplicates/replays,
timeouts, fair batching, review escalation and continued checks, expired/replaced
leases, terminal exclusion, original-provider status endpoints, notification
payloads/formatting/deduplication, scheduler wiring, and graceful shutdown.
Test doubles demonstrate application control flow, not database concurrency safety.

Real integration tests are opt-in. Set `VTU_TEST_MONGODB_URI` to an isolated test
replica set and/or `VTU_TEST_REDIS_URL` to isolated test Redis, then run:

```sh
node --test test/reconciliation.integration.test.js
```

MongoDB tests create and drop only a randomly named test database. They check
concurrent/competing settlements, rollback after a failed transaction write,
duplicate claims, stale leases, and notification uniqueness. Redis tests use an
isolated random key prefix, check stable schedules/global concurrency/restarts,
then remove only that test queue. No provider HTTP calls or purchases are made.
Without explicit test URIs these suites are skipped. Live provider mappings,
account quotas, SMTP delivery, and infrastructure behavior still need environment
verification before rollout.

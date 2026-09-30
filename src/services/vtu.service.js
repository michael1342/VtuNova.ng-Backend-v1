'use strict';

/*
 * WALLET FLOW V3
 *
 * wallet.balance  = total balance
 * wallet.reserved = funds held for pending purchases
 * available       = balance - reserved
 *
 * Pending/network error: balance stays unchanged.
 * Confirmed success: debit balance and release the hold.
 * Confirmed failure: release the hold without crediting balance.
 *
 * Legacy flowVersion 2 purchases already deducted balance:
 * success must not debit them again; failure refunds them once.
 */

require('dotenv').config();

const { createHash, randomBytes } = require('node:crypto');
const axios = require('axios');

const Transaction = require('../models/Transaction.model');
const User = require('../models/User.model');
const AppError = require('../utils/AppError');
const eventBus = require('../events/eventsBus');
const EVENTS = require('../events/events');
const RedisCache = require('../cache/redis_cache');
const cacheKeys = require('../utils/cacheKeys');
const logger = require('../utils/logger');

const reconciliation = require('../config/reconciliation');
const {
    checkIntervalMs: CHECK_INTERVAL_MS,
    leaseMs: CHECK_LEASE_MS,
    reviewAfterMs: REVIEW_AFTER_MS,
} = reconciliation;

const TX_OPTIONS = {
    readConcern: { level: 'snapshot' },
    writeConcern: { w: 'majority' },
    readPreference: 'primary',
};

class VtuService {
    constructor() {
        // Each purchase has its own request ID.
        this.base_url =
            process.env.VTPASS_BASE_URL ||
            'https://sandbox.vtpass.com/api';

        this.api_key = process.env.VTPASS_API_KEY;
        this.secret_key = process.env.VTPASS_SECRET_KEY;
        this.public_key = process.env.VTPASS_PUBLIC_KEY;

        this.quickteller_url =
            process.env.QUICKTELLER_BASE_URL ||
            'https://qa.interswitchng.com/quicktellerservice/api/v5';

        this.quickteller_token_url =
            process.env.QUICKTELLER_TOKEN_URL ||
            'https://qa.interswitchng.com/passport/oauth/token';

        this.quickteller_terminal_id =
            process.env.QUICKTELLER_TERMINAL_ID;

        this.quickteller_token = null;
        this.quickteller_token_expires_at = 0;
        this.tokenPromise = null;
    }

    //--------------01. INPUT VALIDATION AND PURCHASE IDENTITY--------------//

    text(value, name, max = 128) {
        if (
            typeof value !== 'string' ||
            !value.trim() ||
            value.trim().length > max
        ) {
            throw new AppError(
                `${name} must be a nonempty string (max ${max})`,
                400
            );
        }

        return value.trim();
    }

    amount(value) {
        // Existing wallet balances and purchase amounts remain in naira.
        // This version accepts whole naira only.
        if (
            !['string', 'number'].includes(typeof value) ||
            (
                typeof value === 'string' &&
                !/^\d+(?:\.0{1,2})?$/.test(value.trim())
            )
        ) {
            throw new AppError(
                'Amount must be a positive whole-naira value',
                400
            );
        }

        const amount = Number(value);

        if (
            !Number.isSafeInteger(amount) ||
            amount <= 0 ||
            !Number.isSafeInteger(amount * 100)
        ) {
            throw new AppError(
                'Amount must be a positive whole-naira value',
                400
            );
        }

        return amount;
    }

    normalize(data, req, provider, type) {
        const userId = req?.user?._id;

        if (!userId) {
            throw new AppError('Authentication required', 401);
        }

        if (
            !data ||
            typeof data !== 'object' ||
            Array.isArray(data)
        ) {
            throw new AppError('Purchase details are required', 400);
        }

        const requestId = this.text(
            data.requestId ??
            data.request_id ??
            data.requestReference,
            'requestId'
        );

        if (!/^[A-Za-z0-9]+$/.test(requestId)) {
            throw new AppError(
                'requestId must be alphanumeric',
                400
            );
        }

        if (
            provider === 'vtpass' &&
            !/^\d{12}[A-Za-z0-9]+$/.test(requestId)
        ) {
            throw new AppError(
                'VTpass requestId needs YYYYMMDDHHmm plus a unique suffix',
                400
            );
        }

        if (
            provider === 'quickteller' &&
            requestId.length > 20
        ) {
            throw new AppError(
                'Quickteller requestReference must be at most 20 characters',
                400
            );
        }

        const phone = this.text(data.phone, 'phone', 15);

        if (!/^\d{10,15}$/.test(phone)) {
            throw new AppError('Invalid phone number', 400);
        }

        const order = {
            provider,
            type,
            requestId,
            user: userId,
            amount: this.amount(data.amount),
            phone,
            serviceID: '',
            variation_code: '',
            billersCode: '',
            paymentCode: '',
            email: '',
        };

        if (provider === 'quickteller') {
            order.paymentCode = this.text(
                data.paymentCode,
                'paymentCode',
                64
            );

            order.email = data.email
                ? this.text(data.email, 'email', 254)
                : '';
        } else {
            order.serviceID = this.text(
                data.serviceID,
                'serviceID',
                64
            );

            if (
                type === 'airtime' &&
                !['mtn', 'glo', 'airtel', 'etisalat'].includes(
                    order.serviceID
                )
            ) {
                throw new AppError(
                    'Invalid airtime serviceID',
                    400
                );
            }

            if (type === 'data' || type === 'electricity') {
                order.variation_code = this.text(
                    data.variation_code,
                    'variation_code'
                );

                order.billersCode = this.text(
                    data.billersCode ?? data.BillersCode,
                    'billersCode',
                    64
                );
            }

            if (
                type === 'data' &&
                !/^\d{10,15}$/.test(order.billersCode)
            ) {
                throw new AppError(
                    'Data billersCode must be the beneficiary phone number',
                    400
                );
            }

            if (
                type === 'electricity' &&
                (
                    order.serviceID !== 'ikeja-electric' ||
                    !['prepaid', 'postpaid'].includes(
                        order.variation_code
                    )
                )
            ) {
                throw new AppError(
                    'Use ikeja-electric with prepaid or postpaid',
                    400
                );
            }
        }

        // Stable field ordering makes the fingerprint deterministic.
        order.requestFingerprint = createHash('sha256')
            .update(
                JSON.stringify([
                    provider,
                    type,
                    order.amount,
                    phone,
                    order.serviceID,
                    order.variation_code,
                    order.billersCode,
                    order.paymentCode,
                    order.email,
                ])
            )
            .digest('hex');

        return order;
    }

    assertSamePurchase(existing, order) {
        if (
            String(existing.user) !== String(order.user) ||
            existing.requestFingerprint !== order.requestFingerprint
        ) {
            throw new AppError(
                'requestId is already in use for a different purchase',
                409
            );
        }
    }

    assertNewVtpassDate(requestId) {
        const parts = new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Africa/Lagos',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        }).formatToParts(new Date());

        const part = (type) =>
            parts.find((p) => p.type === type).value;

        const today =
            `${part('year')}${part('month')}${part('day')}`;

        if (
            !requestId.startsWith(today) ||
            Number(requestId.slice(8, 10)) > 23 ||
            Number(requestId.slice(10, 12)) > 59
        ) {
            throw new AppError(
                'New requestId requires today’s Lagos date and a valid time',
                400
            );
        }
    }

    //--------------02. PRODUCT AND PROVIDER VALIDATION--------------//

    vtpassHeaders(readOnly = false) {
        const key = readOnly
            ? this.public_key
            : this.secret_key;

        if (
            !this.api_key ||
            !key ||
            this.api_key.startsWith('your-') ||
            key.startsWith('your-')
        ) {
            throw new AppError(
                'VTpass credentials are missing',
                500
            );
        }

        return {
            'Content-Type': 'application/json',
            'api-key': this.api_key,
            [readOnly ? 'public-key' : 'secret-key']: key,
        };
    }

    async preparePurchase(order) {
        if (order.provider === 'quickteller') {
            // Only allow verified variable-amount airtime payment codes.
            const allowed = (
                process.env.QUICKTELLER_AIRTIME_CODES || ''
            )
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);

            if (!allowed.includes(order.paymentCode)) {
                throw new AppError(
                    'Quickteller airtime paymentCode is not configured',
                    400
                );
            }

            // Authentication happens before reserving funds.
            return this.quickteller_get_token();
        }

        this.vtpassHeaders();
        this.assertNewVtpassDate(order.requestId);

        if (order.type === 'data') {
            const allowed = (
                process.env.VTPASS_DATA_SERVICE_IDS ||
                'mtn-data,glo-data,airtel-data,etisalat-data'
            )
                .split(',')
                .map((s) => s.trim());

            if (!allowed.includes(order.serviceID)) {
                throw new AppError(
                    'Unsupported data service',
                    400
                );
            }

            // Verify fixed-price bundles against the provider's current price.
            const plans = await this.Vtpass_vtu_get(
                { serviceID: order.serviceID },
                { fresh: true }
            );

            const plan = plans.content?.variations?.find(
                (p) => p.variation_code === order.variation_code
            );

            if (
                !plan ||
                String(plan.fixedPrice).toLowerCase() !== 'yes'
            ) {
                throw new AppError(
                    'Unknown or unsupported data plan',
                    400
                );
            }

            if (
                this.amount(plan.variation_amount) !== order.amount
            ) {
                throw new AppError(
                    'Data price changed; refresh plans and confirm a new purchase',
                    409
                );
            }
        }

        return null;
    }

    //--------------03. HOLD FUNDS AND CREATE THE PURCHASE--------------//

    async reserve(order) {
        if (User.db !== Transaction.db) {
            throw new AppError(
                'Models must share one MongoDB connection',
                500
            );
        }

        // Prevent strict schemas from silently discarding the hold field.
        if (!User.schema.path('wallet.reserved')) {
            throw new AppError(
                'Add wallet.reserved to the User schema before using wallet flow v3',
                500
            );
        }

        const filter = {
            provider: order.provider,
            requestId: order.requestId,
        };

        const session = await Transaction.db.startSession();
        let result;

        try {
            await session.withTransaction(async () => {
                // [WALLET-1] MongoDB may rerun this callback.
                // Never send provider requests or emit events inside it.
                result = undefined;

                const existing = await Transaction.findOne(filter)
                    .session(session);

                if (existing) {
                    this.assertSamePurchase(existing, order);

                    result = {
                        transaction: existing,
                        created: false,
                    };

                    return;
                }

                const amount = this.amount(order.amount);

                const current = await User.findById(order.user)
                    .select('wallet')
                    .session(session)
                    .lean();

                if (!current) {
                    throw new AppError('User not found', 404);
                }

                const balance = current.wallet?.balance;
                const reserved = current.wallet?.reserved ?? 0;

                if (
                    !Number.isSafeInteger(balance) ||
                    !Number.isSafeInteger(reserved) ||
                    balance < 0 ||
                    reserved < 0 ||
                    reserved > balance
                ) {
                    throw new AppError(
                        'Wallet units or reserved balance require review',
                        409
                    );
                }

                if (current.wallet.walletStatus !== 'active') {
                    throw new AppError(
                        'Wallet is not active',
                        403
                    );
                }

                if (balance - reserved < amount) {
                    throw new AppError(
                        'Insufficient available wallet balance',
                        400
                    );
                }

                // [WALLET-2] Increase the hold only.
                // wallet.balance remains unchanged.
                const user = await User.findOneAndUpdate(
                    {
                        _id: order.user,
                        'wallet.walletStatus': 'active',
                        $expr: {
                            $gte: [
                                {
                                    $subtract: [
                                        '$wallet.balance',
                                        {
                                            $ifNull: [
                                                '$wallet.reserved',
                                                0,
                                            ],
                                        },
                                    ],
                                },
                                amount,
                            ],
                        },
                    },
                    {
                        $inc: {
                            'wallet.reserved': amount,
                        },
                    },
                    {
                        returnDocument: 'after',
                        session,
                    }
                );

                if (!user) {
                    throw new AppError(
                        'Unable to reserve available funds',
                        409
                    );
                }

                const [transaction] = await Transaction.create(
                    [{
                        ...order,
                        amount,
                        flowVersion: 3,
                        status: 'pending',
                        walletState: 'reserved',
                        transactionReference: order.requestId,
                        recipient: order.billersCode || order.phone,
                        service: order.serviceID || order.provider,
                        product_name: {
                            airtime: 'Airtime Recharge',
                            data: 'Data Bundle',
                            electricity: 'Electricity Bill',
                        }[order.type],
                        nextCheckAt: new Date(
                            Date.now() + CHECK_INTERVAL_MS
                        ),
                        reviewAfter: new Date(
                            Date.now() + REVIEW_AFTER_MS
                        ),
                        needsReview: false,
                        checkAttempts: 0,
                    }],
                    { session }
                );

                result = {
                    transaction,
                    created: true,
                };
            }, TX_OPTIONS);
        } catch (err) {
            if (err.code !== 11000) throw err;

            // The required unique provider/requestId index resolves races.
            // Aborted transactions roll back their holds too.
            const existing = await Transaction.findOne(filter);

            if (!existing) throw err;

            this.assertSamePurchase(existing, order);

            result = {
                transaction: existing,
                created: false,
            };
        } finally {
            await session.endSession();
        }

        return result;
    }

    //--------------04. PUBLIC PURCHASE METHODS--------------//

    Vtpass_buy_airtime(data, req) {
        return this.purchase(data, req, 'vtpass', 'airtime');
    }

    Vtpass_buy_data(data, req) {
        return this.purchase(data, req, 'vtpass', 'data');
    }

    Vtpass_by_ikeja_electric(data, req) {
        return this.purchase(data, req, 'vtpass', 'electricity');
    }

    Quickteller_buy_airtime(data, req) {
        return this.purchase(data, req, 'quickteller', 'airtime');
    }

    async purchase(data, req, provider, type) {
        const order = this.normalize(data, req, provider, type);

        const existing = await Transaction.findOne({
            provider,
            requestId: order.requestId,
        });

        if (existing) {
            this.assertSamePurchase(existing, order);
            return await this.publicTransaction(existing);
        }

        const token = await this.preparePurchase(order);

        const { transaction, created } = await this.reserve(order);

        // Duplicate requests never submit another provider purchase.
        if (!created) {
            return await this.publicTransaction(transaction);
        }

        // [EVENT-1] Emit pending after the purchase and hold commit.
        await this.notify(transaction);
        await this.invalidatePurchaseCache(transaction);

        // Record dispatch intent before sending HTTP.
        // Recovery queries the original ID; it never blindly resubmits.
        await Transaction.updateOne(
            {
                _id: transaction._id,
                status: 'pending',
            },
            {
                $set: {
                    submittedAt: new Date(),
                },
            }
        );

        let response;

        try {
            // Exactly one submit call on this execution path.
            response = await this.submit(transaction, token);
        } catch (err) {
            // [TEMP-DEBUG] Remove after diagnosing provider connectivity.
            // Never print Axios headers/config containing credentials.
            console.error('Purchase provider error:', {
                code: err?.code ?? 'NO_ERROR_CODE',
                httpStatus:
                    err?.response?.status ?? 'NO_HTTP_RESPONSE',
                message: err?.message || 'no message'
            });

            logger.warn('Purchase outcome unknown', {
                provider,
                requestId: order.requestId,
                code: err.code,
                httpStatus: err.response?.status,
            });

            await Transaction.updateOne(
                {
                    _id: transaction._id,
                    status: 'pending',
                },
                {
                    $set: {
                        lastProviderError: String(
                            err.code || 'UNKNOWN'
                        ).slice(0, 80),
                    },
                }
            );

            if(err?.code === 'ECONNREFUSED' || err?.code === 'ECONNABORTED') {
                response = await this.submit(transaction, token);
            }

            // [WALLET-3] Unknown result: retain the hold.
            // Do not debit balance, refund, or submit another purchase.
            return await this.publicTransaction(
                await Transaction.findById(transaction._id)
            );
        }

        // Settlement errors propagate; they do not trigger a refund.
        return await this.publicTransaction(
            await this.applyOutcome(
                transaction,
                response,
                'purchase'
            )
        );
    }

    async submit(t, token) {
        if (t.provider === 'vtpass') {
            const payload = {
                request_id: t.requestId,
                serviceID: t.serviceID,
                phone: t.phone,
                amount: t.amount,
            };

            if (t.type !== 'airtime') {
                Object.assign(payload, {
                    billersCode: t.billersCode,
                    variation_code: t.variation_code,
                });
            }

            return (
                await axios.post(
                    `${this.base_url}/pay`,
                    payload,
                    {
                        headers: this.vtpassHeaders(),
                        timeout: 15000,
                    }
                )
            ).data;
        }

        return (
            await axios.post(
                `${this.quickteller_url}/Transactions`,
                {
                    TerminalId: this.quickteller_terminal_id,
                    paymentCode: t.paymentCode,
                    customerId: t.phone,
                    customerMobile: t.phone,
                    amount: String(t.amount * 100),
                    requestReference: t.requestId,
                    ...(t.email
                        ? { customerEmail: t.email }
                        : {}),
                },
                {
                    headers: this.quicktellerHeaders(token),
                    timeout: 15000,
                }
            )
        ).data;
    }

    //--------------05. PROVIDER OUTCOME CLASSIFICATION--------------//

    classify(provider, body, source) {
        if (!body || typeof body !== 'object') {
            return 'pending';
        }

        if (provider === 'vtpass') {
            const code = String(body.code ?? '');

            const status = String(
                body.content?.transactions?.status ?? ''
            ).toLowerCase();

            if (
                ['000', '001'].includes(code) &&
                status === 'delivered'
            ) {
                return 'success';
            }

            // Contradictory responses require investigation.
            if (status === 'delivered') return 'pending';

            if (['016', '091', '040'].includes(code)) {
                return 'failed';
            }

            // Purchase validation rejection differs from a requery error.
            // Requery auth/validation errors do not prove purchase failure.
            if (
                source === 'purchase' &&
                [
                    '010', '011', '012', '013', '017', '018',
                    '020', '021', '022', '023', '024', '027',
                    '028', '030', '034', '035', '085', '087',
                ].includes(code)
            ) {
                return 'failed';
            }

            // Duplicate IDs, not-found responses and unknown codes stay pending.
            return 'pending';
        }

        const code = String(
            body.transactionResponseCode ??
            body.ResponseCode ??
            body.responseCode ??
            ''
        );

        const status = String(
            body.status ?? body.Status ?? ''
        ).toLowerCase();

        if (
            code === '90000' &&
            !['pending', 'failed', 'reversed'].includes(status)
        ) {
            return 'success';
        }

        if (
            source === 'requery' &&
            ['failed', 'reversed'].includes(status) &&
            !['90000', '90009', '90010', '900A0'].includes(code)
        ) {
            return 'failed';
        }

        // Existing Quickteller mappings: verify against your v5 fixtures.
        // HTTP success alone is not a purchase outcome.
        if (
            source === 'purchase' &&
            [
                '90001', '90002', '90003', '90004',
                '90007', '90008', '70070', '70132',
                '900A5', '900A6', '900A7', '900A8', '900A9',
            ].includes(code) &&
            status !== 'completed'
        ) {
            return 'failed';
        }

        return 'pending';
    }

    providerMetadata(t, body) {
        const remote = body?.content?.transactions || {};

        const reference =
            body?.requestId ??
            body?.request_id ??
            body?.requestReference ??
            body?.RequestReference;

        if (
            reference != null &&
            String(reference) !== t.requestId
        ) {
            throw new AppError(
                'Provider response reference mismatch',
                502
            );
        }

        return {
            providerCode: String(
                body?.code ??
                body?.transactionResponseCode ??
                body?.ResponseCode ??
                body?.responseCode ??
                ''
            ).slice(0, 32),

            providerStatus: String(
                remote.status ??
                body?.status ??
                body?.Status ??
                ''
            ).slice(0, 64),

            providerReference: String(
                remote.transactionId ??
                body?.transactionRef ??
                body?.TransactionRef ??
                ''
            ).slice(0, 160),

            // Retain electricity tokens for the customer's receipt.
            purchasedCode: String(
                body?.purchased_code ?? ''
            ).slice(0, 4096),

            lastCheckedAt: new Date(),
        };
    }

    //--------------06. ATOMIC SETTLEMENT--------------//

    async applyOutcome(t, body, source, { leaseToken } = {}) {
        const metadata = this.providerMetadata(t, body);
        const outcome = this.classify(t.provider, body, source);
        const leaseFilter = () => leaseToken ? {
            checkLeaseToken: leaseToken,
            checkLeaseUntil: { $gt: new Date() },
        } : {};

        if (outcome === 'pending') {
            await Transaction.updateOne(
                {
                    _id: t._id,
                    status: 'pending',
                    ...(leaseToken ? leaseFilter() : { checkLeaseToken: null }),
                },
                {
                    $set: {
                        ...metadata,
                    },
                }
            );

            return Transaction.findById(t._id);
        }

        const session = await Transaction.db.startSession();
        let settledHere = false;

        try {
            await session.withTransaction(async () => {
                settledHere = false;

                const current = await Transaction.findById(t._id)
                    .session(session);

                if (!current) {
                    throw new AppError(
                        'Transaction not found',
                        404
                    );
                }

                // A completed transaction must never settle again.
                if (current.status !== 'pending') return;

                // [LEASE-1] An expired/replaced check cannot settle or reschedule.
                if (leaseToken && (current.checkLeaseToken !== leaseToken ||
                    !current.checkLeaseUntil || current.checkLeaseUntil <= new Date())) return;

                if (
                    ![2, 3].includes(current.flowVersion) ||
                    current.walletState !== 'reserved'
                ) {
                    throw new AppError(
                        'Unsupported wallet flow: manual review required',
                        409
                    );
                }

                const amount = this.amount(current.amount);

                const wallet = await User.findById(current.user)
                    .select('wallet')
                    .session(session)
                    .lean();

                if (!wallet) {
                    throw new AppError(
                        'Settlement wallet not found',
                        500
                    );
                }

                const balance = wallet.wallet?.balance;
                const reserved = wallet.wallet?.reserved ?? 0;

                if (
                    !Number.isSafeInteger(balance) ||
                    balance < 0 ||
                    !Number.isSafeInteger(reserved) ||
                    reserved < 0 ||
                    reserved > balance
                ) {
                    throw new AppError(
                        'Wallet accounting requires manual review',
                        409
                    );
                }

                // [WALLET-4] Settle the hold and purchase atomically.
                // A suspended wallet still owes for a fulfilled purchase.
                if (current.flowVersion === 3) {
                    if (reserved < amount) {
                        throw new AppError(
                            'Purchase hold is missing',
                            409
                        );
                    }

                    const changes = {
                        'wallet.reserved': -amount,
                    };

                    // The only new-flow balance debit occurs on success.
                    if (outcome === 'success') {
                        changes['wallet.balance'] = -amount;
                    }

                    const updated = await User.updateOne(
                        {
                            _id: current.user,
                            'wallet.reserved': { $gte: amount },
                            'wallet.balance': { $gte: reserved },
                        },
                        {
                            $inc: changes,
                        },
                        { session }
                    );

                    if (updated.matchedCount !== 1) {
                        throw new AppError(
                            'Wallet settlement failed',
                            409
                        );
                    }
                } else if (outcome === 'failed') {
                    // [LEGACY-V2]
                    // Old reservations already deducted wallet.balance.
                    // Failure refunds once; success does not debit again.
                    if (!Number.isSafeInteger(balance + amount)) {
                        throw new AppError(
                            'Legacy refund exceeds wallet limits',
                            409
                        );
                    }

                    const updated = await User.updateOne(
                        { _id: current.user },
                        {
                            $inc: {
                                'wallet.balance': amount,
                            },
                        },
                        { session }
                    );

                    if (updated.matchedCount !== 1) {
                        throw new AppError(
                            'Legacy refund failed',
                            409
                        );
                    }
                }

                const settled = await Transaction.findOneAndUpdate(
                    {
                        _id: current._id,
                        flowVersion: current.flowVersion,
                        status: 'pending',
                        walletState: 'reserved',
                        ...leaseFilter(),
                    },
                    {
                        $set: {
                            ...metadata,
                            status: outcome,
                            walletState:
                                outcome === 'success'
                                    ? 'charged'
                                    : current.flowVersion === 3
                                        ? 'released'
                                        : 'refunded',
                            settledAt: new Date(),
                            nextCheckAt: null,
                            needsReview: false,
                            ...(outcome === 'success'
                                ? { paidAt: new Date() }
                                : {}),
                        },
                        $unset: { checkLeaseToken: '', checkLeaseUntil: '' },
                    },
                    {
                        session,
                        returnDocument: 'after',
                        runValidators: true,
                    }
                );

                // Throwing also rolls back the preceding wallet update.
                if (!settled) {
                    throw new AppError(
                        'Settlement state changed',
                        409
                    );
                }

                settledHere = true;
            }, TX_OPTIONS);
        } finally {
            await session.endSession();
        }

        const final = await Transaction.findById(t._id);

        if (!final) {
            throw new AppError('Transaction not found', 404);
        }

        if (settledHere) {
            await this.invalidatePurchaseCache(final);
            await this.notify(final);
        }

        return final;
    }

    async invalidatePurchaseCache(transaction) {
        const keys = [
            cacheKeys.userTransactions(transaction.user),
            cacheKeys.transaction(transaction._id),
            cacheKeys.userProfile(transaction.user),
        ];

        for (const key of keys) {
            try {
                await RedisCache.invalidate(key);
            } catch (err) {
                logger.warn('Purchase cache invalidation failed', {
                    message: err.message,
                });
            }
        }
    }

    //--------------SERVICE-SPECIFIC PURCHASE EVENTS--------------//

    async notify(transaction) {
        // [EVENT-2] The event identifies the service.
        // The payload status identifies pending/success/failed.
        // Delivery remains best effort; this is not a durable outbox.
        try {
            if (
                !['pending', 'success', 'failed'].includes(
                    transaction.status
                )
            ) {
                return;
            }

            const purchaseEvent = {
                airtime: EVENTS.AIRTIME_PURCHASE,
                data: EVENTS.DATA_PURCHASE,
                electricity: EVENTS.ELECTRICITY_PURCHASE,
                cable: EVENTS.CABLE_TV_PURCHASE,
                cable_tv: EVENTS.CABLE_TV_PURCHASE,
            }[transaction.type];

            if (!purchaseEvent) {
                throw new Error(
                    'Purchase event is not configured'
                );
            }

            await eventBus.emitSafe(purchaseEvent, {
                transaction,
                user: {
                    _id: transaction.user,
                },
                status: transaction.status,
                eventId:
                    `${transaction._id}-${transaction.status}`,
            });

        } catch (err) {
            logger.error('Purchase notification dispatch failed', {
                requestId: transaction.requestId,
                code: err?.code,
            });
        }
    }

    //--------------07. STATUS READS AND RECONCILIATION--------------//

  async publicTransaction(t) {
        if (!t) {
            throw new AppError('Transaction not found', 404);
        }

          // Notify
        if (t.status === 'pending') {
            await this.notify(t);
        }

        return {
            _id: t._id,
            provider: t.provider,
            requestId: t.requestId,
            requestReference: t.requestId,
            transactionReference: t.transactionReference,
            type: t.type,
            status: t.status,
            walletState: t.walletState,
            amount: t.amount,
            phone: t.phone,
            serviceID: t.serviceID,
            recipient: t.recipient,
            service: t.service,
            product_name: t.product_name,
            variation_code: t.variation_code,
            billersCode: t.billersCode,
            paymentCode: t.paymentCode,
            providerReference: t.providerReference,
            purchasedCode: t.purchasedCode,
            needsReview: Boolean(t.needsReview),
            createdAt: t.createdAt,
            paidAt: t.paidAt,
            settledAt: t.settledAt,
        };

      

    }

    async get_purchase_status(provider, requestId, req) {
        if (!req?.user?._id) {
            throw new AppError('Authentication required', 401);
        }

        return await this.publicTransaction(
            await Transaction.findOne({
                provider,
                requestId: this.text(requestId, 'requestId'),
                user: req.user._id,
            })
        );
    }

    quickteller_check_airtime_status(requestReference, req) {
        return this.get_purchase_status(
            'quickteller',
            requestReference,
            req
        );
    }

    async queryProvider(t) {
        if (t.provider === 'vtpass') {
            return (
                await axios.post(
                    `${this.base_url}/requery`,
                    { request_id: t.requestId },
                    {
                        headers: this.vtpassHeaders(),
                        timeout: 15000,
                    }
                )
            ).data;
        }

        if (t.provider !== 'quickteller') {
            throw new AppError('Unknown provider', 500);
        }

        return (
            await this.quickteller_request({
                method: 'GET',
                url: '/Transactions',
                params: {
                    requestRef: t.requestId,
                },
            })
        ).data;
    }

    async reconcilePendingBatch(limit = reconciliation.batchSize) {
        // Internal worker only. Do not expose as an unauthenticated route.
        if (
            !Number.isInteger(limit) ||
            limit < 2 ||
            limit > 200
        ) {
            throw new Error('Invalid batch limit');
        }

        const result = { checked: 0, errors: 0 };
        let slot = 0;
        let firstError;

        const checkNext = async () => {
            while (slot < limit) {
                // Alternate preferred lanes, borrowing unused capacity from either.
                const reviewLane = slot++ % 2 === 1;
                const now = new Date();
                const leaseToken = randomBytes(16).toString('hex');
                const claim = (needsReview) => Transaction.findOneAndUpdate(
                    {
                        flowVersion: { $in: [2, 3] },
                        status: 'pending',
                        walletState: 'reserved',
                        needsReview: needsReview ? true : { $ne: true },
                        $and: [
                            { $or: [{ nextCheckAt: { $lte: now } }, { nextCheckAt: null }] },
                            { $or: [{ checkLeaseUntil: null }, { checkLeaseUntil: { $lte: now } }] },
                        ],
                    },
                    {
                        $set: {
                            checkLeaseToken: leaseToken,
                            checkLeaseUntil: new Date(
                                Date.now() + CHECK_LEASE_MS
                            ),
                        },
                        $inc: {
                            checkAttempts: 1,
                        },
                    },
                    {
                        returnDocument: 'after',
                        sort: { nextCheckAt: 1, _id: 1 },
                    }
                );

                let t;
                try {
                    t = await claim(reviewLane) || await claim(!reviewLane);
                } catch (err) {
                    firstError ||= err;
                    result.errors++;
                    logger.error('Unable to claim purchases for reconciliation', {
                        errorName: err.name, code: err.code,
                    });
                    return;
                }
                if (!t) return;
                result.checked++;

                const reviewAt = t.reviewAfter || new Date(
                    new Date(t.createdAt).getTime() + REVIEW_AFTER_MS
                );
                const needsReview = Boolean(t.needsReview || reviewAt <= now);
                const context = {
                    transactionId: String(t._id), provider: t.provider,
                    checkAttempt: t.checkAttempts,
                };
                let outcome = 'check-error';
                let providerError;
                let retryAfterMs = 0;

                try {
                    let body;
                    try {
                        body = await this.queryProvider(t);
                    } catch (err) {
                        // Retry-After can be a delay in seconds or an HTTP date.
                        const retryAfter = err.response?.headers?.['retry-after'];
                        if (retryAfter != null) {
                            const delay = /^\d+$/.test(String(retryAfter))
                                ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now();
                            if (Number.isSafeInteger(delay) && delay < 8640000000000000 - Date.now()) {
                                retryAfterMs = Math.max(0, delay);
                            }
                        }
                        providerError = String(err.code || 'STATUS_CHECK_FAILED').slice(0, 80);
                        throw err;
                    }
                    const settled = await this.applyOutcome(t, body, 'requery', { leaseToken });
                    outcome = settled?.status || 'missing';
                } catch (err) {
                    firstError ||= err;
                    result.errors++;
                    logger.warn(
                        'Status check unsuccessful; funds remain reserved',
                        {
                            ...context, code: err.code, errorName: err.name,
                        }
                    );
                } finally {
                    const nextCheckAt = new Date(Date.now() + Math.max(retryAfterMs,
                        needsReview ? reconciliation.reviewIntervalMs : CHECK_INTERVAL_MS));
                    try {
                        // [LEASE-2] Rescheduling and release are one token-guarded write.
                        const updated = await Transaction.updateOne(
                            {
                                _id: t._id,
                                status: 'pending',
                                walletState: 'reserved',
                                checkLeaseToken: leaseToken,
                                checkLeaseUntil: { $gt: new Date() },
                            },
                            {
                                $set: {
                                    nextCheckAt, needsReview, lastCheckedAt: new Date(),
                                    ...(providerError ? { lastProviderError: providerError } : {}),
                                },
                                $unset: {
                                    checkLeaseToken: '',
                                    checkLeaseUntil: '',
                                    ...(!providerError ? { lastProviderError: '' } : {}),
                                },
                            }
                        );

                        if (updated.modifiedCount && needsReview && !t.needsReview) {
                            logger.warn('Pending purchase requires admin review', { ...context, nextCheckAt });
                        }
                        logger.info('Purchase status check finished', {
                            ...context, outcome, needsReview,
                            nextCheckAt: updated.modifiedCount ? nextCheckAt : null,
                        });
                    } catch (err) {
                        firstError ||= err;
                        result.errors++;
                        logger.error('Purchase check scheduling failed', {
                            ...context, errorName: err.name, code: err.code,
                        });
                    }
                }
            }
        };

        await Promise.all(Array.from({ length: Math.min(limit, reconciliation.concurrency) }, checkNext));
        // Other purchases finish, but a failed DB/provider sweep remains visible to BullMQ.
        if (firstError) {
            logger.warn('Purchase reconciliation sweep had failed checks', result);
            const err = new Error('Purchase reconciliation sweep had failed checks');
            err.code = 'RECONCILIATION_CHECK_FAILED';
            throw err;
        }
        return result;
    }

    //--------------08. DATA PLANS AND METER VERIFICATION--------------//

    async Vtpass_vtu_get(data, { fresh = false } = {}) {
        const serviceID = this.text(
            data.serviceID,
            'serviceID',
            64
        );

        const key = cacheKeys.vtuDataPlans(serviceID);

        if (!fresh) {
            try {
                const cached = await RedisCache.retrieve(key);

                if (cached) return cached;
            } catch {
                logger.warn(
                    'Data-plan cache unavailable; reading provider'
                );
            }
        }

        const body = (
            await axios.get(
                `${this.base_url}/service-variations`,
                {
                    params: { serviceID },
                    headers: this.vtpassHeaders(true),
                    timeout: 15000,
                }
            )
        ).data;

        if (!Array.isArray(body?.content?.variations)) {
            throw new AppError(
                'Invalid data-plan response',
                502
            );
        }

        try {
            await RedisCache.set(body, key);
        } catch {
            logger.warn('Unable to cache data plans');
        }

        return body;
    }

    async vtpass_verify_meter_number(data) {
        const payload = {
            billersCode: this.text(
                data.billersCode,
                'billersCode',
                64
            ),
            serviceID: this.text(
                data.serviceID,
                'serviceID',
                64
            ),
            type: this.text(data.type, 'type', 16),
        };

        const body = (
            await axios.post(
                `${this.base_url}/merchant-verify`,
                payload,
                {
                    headers: this.vtpassHeaders(),
                    timeout: 15000,
                }
            )
        ).data;

        if (
            body?.content?.WrongBillersCode ||
            body?.content?.error
        ) {
            throw new AppError(
                String(
                    body.content.error ||
                    'Invalid meter number'
                ),
                400
            );
        }

        if (!['000', '020'].includes(String(body?.code))) {
            throw new AppError(
                'Meter verification unavailable',
                502
            );
        }

        return body;
    }

    //--------------09. QUICKTELLER AUTHENTICATION AND HELPERS--------------//

    quicktellerHeaders(token) {
        return {
            Authorization: `Bearer ${token}`,
            TerminalId: this.quickteller_terminal_id,
            'Content-Type': 'application/json',
        };
    }

    async quickteller_get_token() {
        if (
            this.quickteller_token &&
            Date.now() < this.quickteller_token_expires_at
        ) {
            return this.quickteller_token;
        }

        if (this.tokenPromise) {
            return this.tokenPromise;
        }

        this.tokenPromise = this.fetchQuicktellerToken();

        try {
            return await this.tokenPromise;
        } finally {
            this.tokenPromise = null;
        }
    }

    async fetchQuicktellerToken() {
        const clientId = process.env.QUICKTELLER_CLIENT_ID;
        const clientSecret = process.env.QUICKTELLER_CLIENT_SECRET;

        if (
            !clientId ||
            !clientSecret ||
            !this.quickteller_terminal_id
        ) {
            throw new AppError(
                'Quickteller credentials are missing',
                500
            );
        }

        const body = (
            await axios.post(
                this.quickteller_token_url,
                new URLSearchParams({
                    grant_type: 'client_credentials',
                    scope: 'profile',
                }),
                {
                    headers: {
                        Authorization:
                            `Basic ${Buffer.from(
                                `${clientId}:${clientSecret}`
                            ).toString('base64')
                            }`,
                        'Content-Type':
                            'application/x-www-form-urlencoded',
                    },
                    timeout: 15000,
                }
            )
        ).data;

        if (!body?.access_token) {
            throw new AppError(
                'Quickteller did not return an access token',
                502
            );
        }

        const seconds = Number(body.expires_in);

        this.quickteller_token = body.access_token;

        this.quickteller_token_expires_at =
            Date.now() +
            (
                Number.isFinite(seconds)
                    ? Math.max(0, seconds - 60)
                    : 0
            ) * 1000;

        return this.quickteller_token;
    }

    async quickteller_request(config) {
        const token = await this.quickteller_get_token();

        return axios({
            ...config,
            baseURL: this.quickteller_url,
            timeout: 15000,
            headers: {
                ...config.headers,
                ...this.quicktellerHeaders(token),
            },
        });
    }

    async quickteller_get_airtime_billers() {
        return (
            await this.quickteller_request({
                method: 'GET',
                url: '/services',
                params: {
                    categoryId: 4,
                },
            })
        ).data;
    }

    quickteller_generate_reference() {
        const prefix =
            process.env.QUICKTELLER_REFERENCE_PREFIX;

        if (!/^[A-Za-z0-9]{4}$/.test(prefix || '')) {
            throw new AppError(
                'Configure a four-character Quickteller prefix',
                500
            );
        }

        return `${prefix}${randomBytes(8).toString('hex')}`;
    }
}

module.exports = new VtuService();

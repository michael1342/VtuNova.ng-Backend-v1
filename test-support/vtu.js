const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { compileFunction } = require('node:vm');
const mongoose = require('mongoose');

const logger = { debug() {}, info() {}, warn() {}, error() {} };

// Load application modules without opening production database/provider connections.
function load(relativePath, mocks = {}) {
    const filename = path.resolve(__dirname, '..', relativePath);
    const localRequire = createRequire(filename);
    const module = { exports: {} };
    compileFunction(fs.readFileSync(filename, 'utf8'),
        ['require', 'module', 'exports', '__filename', '__dirname'], { filename })(
        (name) => Object.hasOwn(mocks, name) ? mocks[name] : localRequire(name),
        module, module.exports, filename, path.dirname(filename));
    return module.exports;
}

const config = {
    checkIntervalMs: 300000, reviewAfterMs: 86400000, reviewIntervalMs: 3600000,
    leaseMs: 180000, batchSize: 50, concurrency: 3,
};

function makeService({ transaction = {}, users = {}, events = { emitSafe() {} }, cache = {},
    axios = {}, log = logger, settings = {} } = {}) {
    return load('src/services/vtu.service.js', {
        dotenv: { config() {} }, axios,
        '../models/Transaction.model': transaction,
        '../models/User.model': users,
        '../events/eventsBus': events,
        '../cache/redis_cache': { async invalidate() {}, ...cache },
        '../utils/logger': log,
        '../config/reconciliation': { ...config, ...settings },
    });
}

function query(getValue) {
    return {
        session() { return this; }, select() { return this; }, lean() { return this; },
        then(resolve, reject) { return Promise.resolve().then(getValue).then(resolve, reject); },
    };
}

function purchase(overrides = {}) {
    return {
        _id: new mongoose.Types.ObjectId(), user: new mongoose.Types.ObjectId(), flowVersion: 3,
        provider: 'vtpass', requestId: '202609261230abc123', requestFingerprint: 'a'.repeat(64),
        type: 'airtime', status: 'pending', walletState: 'reserved', amount: 500,
        phone: '08012345678', serviceID: 'mtn', nextCheckAt: new Date(0),
        createdAt: new Date(), reviewAfter: new Date(Date.now() + config.reviewAfterMs),
        needsReview: false, checkAttempts: 0, ...overrides,
    };
}

function matches(record, filter) {
    return Object.entries(filter).every(([key, value]) => {
        if (key === '$or') return value.some((part) => matches(record, part));
        if (key === '$and') return value.every((part) => matches(record, part));
        const actual = record[key];
        if (value === null) return actual == null;
        if (value && Object.getPrototypeOf(value) === Object.prototype) {
            return Object.entries(value).every(([op, expected]) => {
                if (op === '$in') return expected.includes(actual);
                if (op === '$ne') return actual !== expected;
                if (op === '$lte') return actual != null && actual <= expected;
                if (op === '$gt') return actual != null && actual > expected;
                throw new Error(`Unsupported test filter ${op}`);
            });
        }
        return String(actual) === String(value);
    });
}

// These doubles verify control flow only, not MongoDB concurrency or isolation.
function harness(records = [purchase()], options = {}) {
    const state = { records, wallet: { balance: 5000, reserved: 500 }, events: [], logs: [], writes: 0 };
    const update = (record, changes) => {
        Object.assign(record, changes.$set);
        for (const key of Object.keys(changes.$unset || {})) delete record[key];
        for (const [key, value] of Object.entries(changes.$inc || {})) record[key] = (record[key] || 0) + value;
        return { ...record };
    };
    const transaction = {
        db: { async startSession() { return { async withTransaction(run) { await run(); }, async endSession() {} }; } },
        findById(id) { return query(() => records.find((t) => String(t._id) === String(id))); },
        async findOneAndUpdate(filter, changes) {
            const record = records.filter((t) => matches(t, filter))
                .sort((a, b) => (a.nextCheckAt || 0) - (b.nextCheckAt || 0))[0];
            return record ? update(record, changes) : null;
        },
        async updateOne(filter, changes) {
            const record = records.find((t) => matches(t, filter));
            if (record) update(record, changes);
            return { modifiedCount: record ? 1 : 0, matchedCount: record ? 1 : 0 };
        },
    };
    const users = {
        findById() { return query(() => ({ wallet: state.wallet })); },
        async updateOne(filter, changes) {
            state.writes++;
            for (const [key, value] of Object.entries(changes.$inc)) state.wallet[key.split('.')[1]] += value;
            return { matchedCount: 1 };
        },
    };
    const log = Object.fromEntries(Object.keys(logger).map((level) => [level,
        (message, data) => state.logs.push({ level, message, data })]));
    const service = makeService({ transaction, users, events: { emitSafe: (...args) => state.events.push(args) },
        log, ...options });
    service.submit = () => { throw new Error('Reconciliation must never submit a purchase'); };
    return { service, state, transaction, users };
}

module.exports = { load, makeService, query, purchase, harness, logger, config };

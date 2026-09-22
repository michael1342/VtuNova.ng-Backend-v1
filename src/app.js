const express   = require('express');
const helmet    = require('helmet');
const cors      = require('cors');
const morgan    = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const path      = require('path');

// Express-5-safe replacement for express-mongo-sanitize (see that file for why).
const mongoSanitize = require('./middleware/sanitize');

//Routes
const authRoutes = require('./routes/Auth.routes');
const userRoutes = require('./routes/Users.routes');
const adminRoutes = require('./routes/Admin.routes');
const transactionRoutes = require('./routes/Transactions.routes');
const vtuRoutes = require('./routes/Vtu.routes');
const notificationRoutes = require('./routes/Notification.routes');
const paystackRoutes = require('./routes/Paystack.routes');
const errorHandler = require('./middleware/errorHandling')

const logger = require('./utils/logger');


const app = express();


// Rate limiters sit behind a proxy in most deployments; without this the
// limiter sees the proxy IP for everyone and throttles all users together.
app.set('trust proxy', 1);

// ── Security ──────────────────────────────────────────────────────
app.use(helmet());

const allowedOrigins = [
  'http://localhost:5174',
  process.env.FRONTEND_URL
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// ── Body parsing ──────────────────────────────────────────────────
// `verify` hands us the raw buffer before parsing. The Paystack webhook needs
// the exact bytes that were signed — re-serialising the parsed object with
// JSON.stringify() is not byte-identical and breaks HMAC verification.
app.use(express.json({
  limit: '10mb',
  verify: (req, res, buf) => { req.rawBody = buf; },
}));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Strip Mongo operators AFTER parsing, so req.body is populated.
app.use(mongoSanitize());

app.use(compression());
app.use(morgan('dev', { stream: { write: (msg) => logger.http(msg.trim()) } }));
app.use(cookieParser())

// ── Rate limiting ─────────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, message: 'Too many requests, please try again later.' },
  // Paystack retries webhooks; throttling them would drop real payment
  // confirmations. That endpoint is protected by signature verification instead.
  skip: (req) => req.path === '/api/payments/webhook',
});
app.use(globalLimiter);

// ── Static files ──────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.use("/upload", express.static(path.join(process.cwd(), "upload")));

// ── Health check ──────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    service: process.env.APP_NAME || 'VtuNova',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
  });
});

// ── Error Handler ────────────────────────────────────────────────────
app.use(errorHandler)

// ── API Routes ────────────────────────────────────────────────────
const API = '/api';

app.use(`${API}/auth`, authRoutes);
app.use(`${API}/users`, userRoutes);
app.use(`${API}/admin`, adminRoutes);
app.use(`${API}/transactions`, transactionRoutes);
app.use(`${API}/vtu`, vtuRoutes);
app.use(`${API}/notifications`, notificationRoutes);
app.use(`${API}/payments`, paystackRoutes);

module.exports = app;


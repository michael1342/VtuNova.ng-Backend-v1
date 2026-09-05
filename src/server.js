const express = require('express');
const registerEmailListeners = require('../src/listeners/email.listener.js');
const registerNotificationListeners = require('../src/listeners/notifications.listener.js');
const app = express();
app.use(express.json());
require('dotenv').config();
const crypto = require('crypto')
const port = process.env.PORT;
const paystackRoutes = require('./routes/Paystack.route.js')
const authRoutes = require('./routes/Auth.routes.js')
const transactionRoute = require('./routes/Transactions.route.js')
const AdminRoute = require('./routes/Admin.routes.js')
const VtuRoute = require('./routes/Vtu.routes.js')
const UserRoute = require('./routes/Users.route.js')
const NotificationRoute = require('./routes/Notification.route.js')
const connectDB = require('./config/database.js')
const cookieParser = require('cookie-parser')
const cors = require('cors')
const path = require('path')
require('./worker/notification.worker.js')
require('./worker/email.worker.js')
const emailService = require('./services/email.service.js');


app.use(cors({
    origin: ['http://localhost:5174', 'https://ftr3lxvw-5174.uks1.devtunnels.ms'], // Explicitly allow your frontend domain
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'], // Allowed HTTP verbs
    allowedHeaders: ['Content-Type', 'Authorization'], // Allowed custom headers
    credentials: true // Enable if sending cookies or auth headers
}));

// app.use('/upload', express.static(path.join(__dirname, 'upload')))
app.use("/upload", express.static(path.join(process.cwd(), "upload")));

connectDB()
app.use(cookieParser())

app.use('/api/transactions', transactionRoute);
app.use('/api/paystack', paystackRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/admin', AdminRoute);
app.use('/api/vtu', VtuRoute);
app.use('/api/users', UserRoute);
app.use('/api/notifications', NotificationRoute);

// registerEmailListeners();
// startEmailRetryJob();

const start = async () => {
    try {
        await emailService.verify();
        // await notificationWorker();
        registerEmailListeners()
        registerNotificationListeners()
    } catch (err) {
        console.log(err);
    }
}
start();
app.listen(port, () => {
    console.log(`Server running at ${port}`);
})
    .on('error', (err) => {
        console.log(err);
    })
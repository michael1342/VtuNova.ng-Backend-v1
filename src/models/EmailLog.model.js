const mongoose = require('mongoose')
require('dotenv').config();

const RETENTION_DAYS = Number(process.env.EMAIL_LOG_RETENTION_DAYS) || 180

const emailLogSchema = new mongoose.Schema({
    to: { type: String, required: true },
    from: { type: String },
    subject: { type: String, required: true },
    template: { type: String, required: true, index: true },
    status: {},
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 3 },
    lastAttempsAt: Date,
    
}, { timestamps: true })  

module.exports = mongoose.model('emailLog', emailLogSchema)
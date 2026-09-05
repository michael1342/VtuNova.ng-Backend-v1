const mongoose = require('mongoose');
const Transaction = require('../models/Transaction.model');
const AppError = require('../utils/AppError');

class ChartsService {
    constructor() {}

    /**
     * Get monthly transaction statistics for a specific user and year
     * @param {string|mongoose.Types.ObjectId} [userId] - Optional user ID
     * @param {number|string} [year] - Year to fetch metrics for (defaults to current year)
     * @returns {Promise<Object>} Aggregated monthly transaction data and yearly summary
     */
    async getMonthlyTransactions(userId, year) {
        try {
            const selectedYear = year ? parseInt(year, 10) : new Date().getFullYear();
            if (isNaN(selectedYear)) {
                throw new AppError('Invalid year provided', 400);
            }

            const startDate = new Date(selectedYear, 0, 1, 0, 0, 0, 0);
            const endDate = new Date(selectedYear, 11, 31, 23, 59, 59, 999);

            const matchQuery = {
                createdAt: {
                    $gte: startDate,
                    $lte: endDate,
                },
            };

            if (userId) {
                if (mongoose.Types.ObjectId.isValid(userId)) {
                    matchQuery.user = new mongoose.Types.ObjectId(userId);
                } else {
                    throw new AppError('Invalid user ID provided', 400);
                }
            }

            const aggregatedData = await Transaction.aggregate([
                { $match: matchQuery },
                {
                    $group: {
                        _id: { $month: '$createdAt' },
                        totalAmount: { $sum: '$amount' },
                        totalTransactions: { $sum: 1 },
                        successfulTransactions: {
                            $sum: {
                                $cond: [{ $eq: ['$status', 'success'] }, 1, 0],
                            },
                        },
                        failedTransactions: {
                            $sum: {
                                $cond: [{ $eq: ['$status', 'failed'] }, 1, 0],
                            },
                        },
                        pendingTransactions: {
                            $sum: {
                                $cond: [{ $eq: ['$status', 'pending'] }, 1, 0],
                            },
                        },
                        successfulAmount: {
                            $sum: {
                                $cond: [{ $eq: ['$status', 'success'] }, '$amount', 0],
                            },
                        },
                    },
                },
                { $sort: { _id: 1 } },
            ]);

            const monthMap = new Map();
            aggregatedData.forEach((item) => {
                monthMap.set(item._id, item);
            });

            const months = [
                { month: 1, monthName: 'January', shortMonth: 'Jan' },
                { month: 2, monthName: 'February', shortMonth: 'Feb' },
                { month: 3, monthName: 'March', shortMonth: 'Mar' },
                { month: 4, monthName: 'April', shortMonth: 'Apr' },
                { month: 5, monthName: 'May', shortMonth: 'May' },
                { month: 6, monthName: 'June', shortMonth: 'Jun' },
                { month: 7, monthName: 'July', shortMonth: 'Jul' },
                { month: 8, monthName: 'August', shortMonth: 'Aug' },
                { month: 9, monthName: 'September', shortMonth: 'Sep' },
                { month: 10, monthName: 'October', shortMonth: 'Oct' },
                { month: 11, monthName: 'November', shortMonth: 'Nov' },
                { month: 12, monthName: 'December', shortMonth: 'Dec' },
            ];

            let yearlyTotalAmount = 0;
            let yearlyTotalTransactions = 0;
            let yearlySuccessfulAmount = 0;
            let yearlySuccessfulTransactions = 0;

            const monthlyData = months.map((m) => {
                const data = monthMap.get(m.month);
                const totalAmount = data ? data.totalAmount : 0;
                const totalTransactions = data ? data.totalTransactions : 0;
                const successfulTransactions = data ? data.successfulTransactions : 0;
                const failedTransactions = data ? data.failedTransactions : 0;
                const pendingTransactions = data ? data.pendingTransactions : 0;
                const successfulAmount = data ? data.successfulAmount : 0;

                yearlyTotalAmount += totalAmount;
                yearlyTotalTransactions += totalTransactions;
                yearlySuccessfulAmount += successfulAmount;
                yearlySuccessfulTransactions += successfulTransactions;

                return {
                    month: m.month,
                    monthName: m.monthName,
                    shortMonth: m.shortMonth,
                    totalAmount,
                    totalTransactions,
                    successfulTransactions,
                    failedTransactions,
                    pendingTransactions,
                    successfulAmount,
                };
            });

            return {
                year: selectedYear,
                summary: {
                    totalAmount: yearlyTotalAmount,
                    totalTransactions: yearlyTotalTransactions,
                    successfulAmount: yearlySuccessfulAmount,
                    successfulTransactions: yearlySuccessfulTransactions,
                },
                monthlyData,
            };
        } catch (err) {
            throw err instanceof AppError ? err : new AppError(err.message, 500);
        }
    }
}

module.exports = new ChartsService();
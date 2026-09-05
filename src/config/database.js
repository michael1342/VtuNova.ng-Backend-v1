const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config();
const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/your-database-name';

const connectDB = async () => {
    try {
        console.log('Connecting to MongoDB...');
        await mongoose.connect(mongoURI, {});
        console.log('Connected to MongoDB');

        mongoose.connection.on('disconnected', (err) => {
            console.error('MongoDB connection error:', err);
        });

        mongoose.connection.on('reconnected', (err) => {
            console.warn('MongoDB connection warning:', err);
        });
    } catch (error) {
        console.error('Error connecting to MongoDB:', error);
        process.exit(1); // Exit the process with an error code
    }
}

module.exports = connectDB
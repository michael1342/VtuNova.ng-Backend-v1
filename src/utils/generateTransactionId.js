const crypto = require('crypto');

const generateTransactionId = () => {
    const part1 = crypto.randomBytes(2).toString('hex').toUpperCase();
    const part2 = crypto.randomBytes(2).toString('hex').toUpperCase();
    return `VTN-${part1}-${part2}`;
};

module.exports = generateTransactionId;
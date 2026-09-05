const crypto = require('crypto');

const generateRequest_id = () => {
    const four_digit_string = crypto.randomBytes(4).toString('hex');
    return `${new Date().toISOString().slice(0, 10).replace(/-/g, '')}${four_digit_string}`
}

module.exports = generateRequest_id
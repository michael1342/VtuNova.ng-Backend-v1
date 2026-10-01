'use strict';

const crypto = require('node:crypto');
require('dotenv').config()

//--------------ENCRYPT ONLY THE IMMUTABLE REQUEST AND CREDENTIAL REFERENCE--------------//
function key() {
    const encoded = process.env.EMAIL_PAYLOAD_ENCRYPTION_KEY || '';
    const value = Buffer.from(encoded, 'base64');
    if (value.length !== 32 || value.toString('base64') !== encoded) {
        throw new Error('EMAIL_PAYLOAD_ENCRYPTION_KEY must be a base64 encoded 32-byte key');
    }
    return value;
}

function encrypt(value, dedupeKey) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
    cipher.setAAD(Buffer.from(dedupeKey));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), ciphertext.toString('base64')].join('.');
}

function decrypt(value, dedupeKey) {
    const [version, iv, tag, ciphertext] = String(value).split('.');
    if (version !== 'v1') throw new Error('email_payload_invalid');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
    decipher.setAAD(Buffer.from(dedupeKey));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8'));
}

module.exports = { encrypt, decrypt, validateKey: key };

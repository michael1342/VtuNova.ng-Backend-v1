const {
    layout,
    heading,
    paragraph,
    button,
    detailBox,
    infoNote,
    successBox,
    BRAND,
} = require('./layout');


/* ============================================================
   HELPERS
============================================================ */

const fullName = (user = {}) =>
    `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'there';

const portal = (path = '') => `${BRAND.url}${path}`;


/* ============================================================
   EMAIL TEMPLATES
============================================================ */

const TEMPLATE = {

    /* ========================================================
       ACCOUNT & SECURITY
    ======================================================== */

    loginAlert: (data) => ({
        subject: `New sign-in to your account`,

        html: layout(
            heading('New sign-in detected') +

            paragraph(`Hello ${data.fullName || 'there'},`) +

            paragraph(
                'Your VtuNova account was just signed in to. ' +
                'If this was you, no action is required.'
            ) +

            detailBox([
                ['Time', data.time || 'Unknown'],
                ['Device', data.device || 'Unknown device'],
                ['IP Address', data.ipAddress || 'Unknown'],
            ]) +

            infoNote(
                'If you did not sign in, your account may be compromised. ' +
                `Please change your password immediately or contact ` +
                `<a href="mailto:${BRAND.supportEmail}" ` +
                `style="color:${BRAND.secondary};">` +
                `${BRAND.supportEmail}</a>.`,
                '#DC2626'
            ),

            {
                preheader:
                    'A new sign-in to your VtuNova account was detected.',
            }
        ),

        text: `
New sign-in to your ${BRAND.name} account.

Hello ${data.fullName || 'there'},

A new sign-in was detected.

Time: ${data.time || 'Unknown'}
Device: ${data.device || 'Unknown device'}
IP Address: ${data.ipAddress || 'Unknown'}

If this wasn't you, change your password immediately and contact
${BRAND.supportEmail}.
        `.trim(),
    }),


    passwordChanged: (data) => ({
        subject: `Your ${BRAND.name} password was changed`,

        html: layout(
            heading('Password changed') +

            paragraph(`Hello ${data.fullName || 'there'},`) +

            paragraph(
                'This confirms that your VtuNova account password ' +
                'was successfully changed.'
            ) +

            detailBox([
                ['Time', data.time || 'Unknown'],
            ]) +

            infoNote(
                `If you did not make this change, please contact us immediately at ` +
                `<a href="mailto:${BRAND.supportEmail}" ` +
                `style="color:${BRAND.secondary};">` +
                `${BRAND.supportEmail}</a>.`,
                '#DC2626'
            ),

            {
                preheader:
                    'Your VtuNova account password was changed.',
            }
        ),

        text: `
Your ${BRAND.name} password was changed.

Hello ${data.fullName || 'there'},

Time: ${data.time || 'Unknown'}

If this wasn't you, contact ${BRAND.supportEmail} immediately.
        `.trim(),
    }),


    passwordReset: (data) => ({
        subject: `Reset your ${BRAND.name} password`,

        html: layout(
            heading('Reset your password') +

            paragraph(`Hello ${data.fullName || 'there'},`) +

            paragraph(
                'We received a request to reset your VtuNova account password.'
            ) +

            paragraph(
                'Click the button below to create a new password. ' +
                'If you did not request this, you can safely ignore this email.'
            ) +

            button(
                'Reset Password',
                data.resetUrl
            ) +

            infoNote(
                'For security reasons, this password reset link may expire after a limited period.',
                BRAND.secondary
            ),

            {
                preheader:
                    'Reset your VtuNova account password.',
            }
        ),

        text: `
Hello ${data.fullName || 'there'},

We received a request to reset your password.

Reset your password here:
${data.resetUrl}

If you did not request this, you can ignore this email.
        `.trim(),
    }),


    emailVerification: (data) => ({
        subject: `Verify your ${BRAND.name} email address`,

        html: layout(
            heading('Verify your email address') +

            paragraph(`Hello ${data.fullName || 'there'},`) +

            paragraph(
                'Welcome to VtuNova! Please verify your email address ' +
                'to secure your account and complete your registration.'
            ) +

            button(
                'Verify Email Address',
                data.verificationUrl
            ) +

            infoNote(
                'If you did not create a VtuNova account, you can safely ignore this email.'
            ),

            {
                preheader:
                    'Verify your email address to complete your VtuNova registration.',
            }
        ),

        text: `
Hello ${data.fullName || 'there'},

Welcome to ${BRAND.name}.

Verify your email address:
${data.verificationUrl}
        `.trim(),
    }),


    /* ========================================================
       WALLET
    ======================================================== */

    walletFunded: (data) => ({
        subject: `Wallet funded successfully — ₦${data.amount}`,

        html: layout(
            heading('Wallet funded successfully 🎉') +

            paragraph(`Hello ${data.fullName || 'there'},`) +

            successBox(
                'Payment Successful',
                'Your VtuNova wallet has been credited successfully.'
            ) +

            detailBox([
                ['Amount', `₦${data.amount}`],
                ['Reference', data.reference],
                ['Payment Method', data.paymentMethod || 'Online Payment'],
                ['New Balance', `₦${data.newBalance}`],
                ['Date', data.time],
            ]) +

            button(
                'View Wallet',
                portal('/wallet')
            ),

            {
                preheader:
                    `Your VtuNova wallet has been credited with ₦${data.amount}.`,
            }
        ),

        text: `
Hello ${data.fullName || 'there'},

Your VtuNova wallet was funded successfully.

Amount: ₦${data.amount}
Reference: ${data.reference}
New Balance: ₦${data.newBalance}

View your wallet:
${portal('/wallet')}
        `.trim(),
    }),


    walletDebit: (data) => ({
        subject: `Wallet debit alert — ₦${data.amount}`,

        html: layout(
            heading('Wallet debit alert') +

            paragraph(`Hello ${data.fullName || 'there'},`) +

            paragraph(
                'A debit has been made from your VtuNova wallet.'
            ) +

            detailBox([
                ['Amount', `₦${data.amount}`],
                ['Description', data.description || 'Transaction'],
                ['Reference', data.reference],
                ['New Balance', `₦${data.newBalance}`],
                ['Date', data.time],
            ]) +

            infoNote(
                'If you do not recognise this transaction, please contact support immediately.',
                '#DC2626'
            ),

            {
                preheader:
                    `₦${data.amount} was debited from your VtuNova wallet.`,
            }
        ),

        text: `
Hello ${data.fullName || 'there'},

A debit was made from your VtuNova wallet.

Amount: ₦${data.amount}
Reference: ${data.reference}
New Balance: ₦${data.newBalance}

If you do not recognise this transaction, contact
${BRAND.supportEmail}.
        `.trim(),
    }),


    /* ========================================================
       TRANSACTIONS
    ======================================================== */

    transactionSuccessful: (data) => ({
        subject: `${data.service || 'Transaction'} successful — ₦${data.amount}`,

        html: layout(
            heading(`Hello, ${data.fullName || 'there'} 👋`) +

            paragraph(
                'Your transaction was successful. Here are the details of your purchase.'
            ) +

            successBox(
                'Transaction Successful',
                'Thank you for using VtuNova.'
            ) +

            detailBox([
                ['Service', data.service || '—'],
                ['Network', data.network || '—'],
                ['Recipient', data.recipient || '—'],
                ['Amount', `₦${data.amount}`],
                ['Reference', data.reference],
                ['Payment Method', data.paymentMethod || 'VtuNova Wallet'],
                ['New Balance', `₦${data.newBalance}`],
                ['Date', data.time],
            ]) +

            button(
                'View Transaction',
                portal(`/transactions/${data.transactionId || ''}`)
            ),

            {
                preheader:
                    `Your ${data.service || 'transaction'} was successful.`,
            }
        ),

        text: `
Hello ${data.fullName || 'there'},

Your transaction was successful.

Service: ${data.service || '—'}
Amount: ₦${data.amount}
Reference: ${data.reference}
New Balance: ₦${data.newBalance}

Thank you for using ${BRAND.name}.
        `.trim(),
    }),


    transactionFailed: (data) => ({
        subject: `${data.service || 'Transaction'} failed`,

        html: layout(
            heading('Transaction unsuccessful') +

            paragraph(`Hello ${data.fullName || 'there'},`) +

            paragraph(
                'Unfortunately, your transaction could not be completed.'
            ) +

            detailBox([
                ['Service', data.service || '—'],
                ['Amount', `₦${data.amount}`],
                ['Reference', data.reference || '—'],
                ['Reason', data.reason || 'Transaction could not be completed'],
                ['Date', data.time],
            ]) +

            infoNote(
                'If your wallet was debited, please allow some time for the transaction to be processed or reversed.',
                '#D97706'
            ) +

            button(
                'View Transactions',
                portal('/transactions')
            ),

            {
                preheader:
                    'Your VtuNova transaction could not be completed.',
            }
        ),

        text: `
Hello ${data.fullName || 'there'},

Your transaction could not be completed.

Service: ${data.service || '—'}
Amount: ₦${data.amount}
Reference: ${data.reference || '—'}
Reason: ${data.reason || 'Unknown'}

If you were debited, please contact support if the issue persists.
        `.trim(),
    }),


    transactionReversed: (data) => ({
        subject: `Transaction reversed — ₦${data.amount}`,

        html: layout(
            heading('Transaction reversed') +

            paragraph(`Hello ${data.fullName || 'there'},`) +

            paragraph(
                'Your unsuccessful transaction has been reversed and the funds have been returned to your wallet.'
            ) +

            successBox(
                'Funds Reversed Successfully',
                'The transaction amount has been returned to your VtuNova wallet.'
            ) +

            detailBox([
                ['Amount Reversed', `₦${data.amount}`],
                ['Original Reference', data.reference],
                ['New Balance', `₦${data.newBalance}`],
                ['Date', data.time],
            ]) +

            button(
                'View Wallet',
                portal('/wallet')
            ),

            {
                preheader:
                    `₦${data.amount} has been returned to your VtuNova wallet.`,
            }
        ),

        text: `
Hello ${data.fullName || 'there'},

Your transaction was reversed successfully.

Amount Reversed: ₦${data.amount}
Reference: ${data.reference}
New Balance: ₦${data.newBalance}
        `.trim(),
    }),


    /* ========================================================
       WITHDRAWALS
    ======================================================== */

    withdrawalSuccessful: (data) => ({
        subject: `Withdrawal successful — ₦${data.amount}`,

        html: layout(
            heading('Withdrawal successful') +

            paragraph(`Hello ${data.fullName || 'there'},`) +

            successBox(
                'Transfer Successful',
                'Your withdrawal has been processed successfully.'
            ) +

            detailBox([
                ['Amount', `₦${data.amount}`],
                ['Bank', data.bankName],
                ['Account Name', data.accountName],
                ['Account Number', data.accountNumber],
                ['Reference', data.reference],
                ['New Balance', `₦${data.newBalance}`],
            ]) +

            button(
                'View Transactions',
                portal('/transactions')
            ),

            {
                preheader:
                    `Your withdrawal of ₦${data.amount} was successful.`,
            }
        ),

        text: `
Hello ${data.fullName || 'there'},

Your withdrawal was successful.

Amount: ₦${data.amount}
Bank: ${data.bankName}
Account: ${data.accountNumber}
Reference: ${data.reference}
        `.trim(),
    }),
};


/* ============================================================
   RENDER TEMPLATE
============================================================ */

const render = (templateName, data = {}) => {
    const template = TEMPLATE[templateName];

    if (!template) {
        throw new Error(
            `Unknown email template: "${templateName}"`
        );
    }

    return template(data);
};


module.exports = {
    render,
    TEMPLATE,
};
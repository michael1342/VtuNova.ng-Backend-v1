const PDFDocument = require('pdfkit');

class ReceiptService {
    constructor() {}

    /**
     * Format a date into 'DD Mon YYYY • HH:mm' (e.g., '13 Aug 2026 • 19:01')
     */
    formatDateTime(dateInput) {
        try {
            const date = dateInput ? new Date(dateInput) : new Date();
            const day = date.getDate();
            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            const month = months[date.getMonth()];
            const year = date.getFullYear();
            const hours = String(date.getHours()).padStart(2, '0');
            const minutes = String(date.getMinutes()).padStart(2, '0');
            return `${day} ${month} ${year} • ${hours}:${minutes}`;
        } catch {
            return '13 Aug 2026 • 19:01';
        }
    }

    /**
     * Capitalize / format service name nicely
     */
    formatService(serviceName, productName) {
        if (productName && productName.trim()) return productName;
        if (!serviceName) return 'Transaction';

        const map = {
            'electricity': 'Electricity Bill',
            'electricity bill': 'Electricity Bill',
            'airtime': 'Airtime Recharge',
            'data': 'Data Bundle',
            'cable': 'Cable TV',
            'cable tv': 'Cable TV',
            'deposit': 'Wallet Topup',
            'transfer': 'Funds Transfer',
            'withdrawal': 'Withdrawal'
        };

        const key = serviceName.toLowerCase().trim();
        if (map[key]) return map[key];

        // Default Title Case
        return serviceName.replace(/\b\w/g, (c) => c.toUpperCase());
    }

    /**
     * Draw precise vector Naira currency symbol and formatted amount
     */
    drawNairaText(doc, amountFormatted, rightX, baselineY, fontSize, color = '#FFFFFF') {
        doc.save();
        doc.font('Helvetica-Bold').fontSize(fontSize).fillColor(color);

        const numText = amountFormatted;
        const numWidth = doc.widthOfString(numText);
        const nWidth = doc.widthOfString('N');
        const totalWidth = nWidth + numWidth + 2;
        const startX = rightX - totalWidth;

        // Draw 'N'
        doc.text('N', startX, baselineY, { lineBreak: false });

        // Draw the two horizontal crossbars for standard ₦ symbol
        const barLineWidth = Math.max(1, fontSize * 0.07);
        const overHang = fontSize * 0.06;
        const topBarY = baselineY + (fontSize * 0.28);
        const botBarY = baselineY + (fontSize * 0.44);

        doc.strokeColor(color)
           .lineWidth(barLineWidth)
           .moveTo(startX - overHang, topBarY)
           .lineTo(startX + nWidth + overHang, topBarY)
           .stroke();

        doc.moveTo(startX - overHang, botBarY)
           .lineTo(startX + nWidth + overHang, botBarY)
           .stroke();

        // Draw numeric value
        doc.text(numText, startX + nWidth + 2, baselineY, { lineBreak: false });
        doc.restore();
    }

    /**
     * Generate PDF stream for the transaction receipt
     * @param {Object} transaction - Transaction object or data
     * @param {Stream} outputStream - Writable stream (e.g. Express res or fs stream)
     */
    generateReceiptPDF(transaction, outputStream) {
        return new Promise((resolve, reject) => {
            const width = 380;
            const height = 470;

            const doc = new PDFDocument({
                size: [width, height],
                margins: { top: 0, bottom: 0, left: 0, right: 0 }
            });

            doc.pipe(outputStream);

            // 1. Outer Dark Canvas
            doc.rect(0, 0, width, height).fill('#0B0F19');

            // 2. Receipt Card Container
            const cardMargin = 12;
            const cardX = cardMargin;
            const cardY = cardMargin;
            const cardWidth = width - (cardMargin * 2);
            const cardHeight = height - (cardMargin * 2);
            const cardRadius = 20;

            doc.roundedRect(cardX, cardY, cardWidth, cardHeight, cardRadius)
               .fillAndStroke('#0F1424', '#1E293B');

            const contentX = cardX + 24;
            const contentWidth = cardWidth - 48;
            let currentY = cardY + 28;

            // 3. Header: Brand
            doc.fontSize(22)
               .font('Helvetica-Bold')
               .fillColor('#3B82F6')
               .text('VtuNova', contentX, currentY, { align: 'center', width: contentWidth });

            currentY += 26;

            // Header Subtitle
            doc.fontSize(9)
               .font('Helvetica-Bold')
               .fillColor('#64748B')
               .text('TRANSACTION RECEIPT', contentX, currentY, { align: 'center', width: contentWidth, characterSpacing: 1.5 });

            currentY += 24;

            // 4. Dashed Divider 1
            doc.save();
            doc.strokeColor('#1E293B')
               .lineWidth(1)
               .dash(2.5, { space: 3 })
               .moveTo(contentX, currentY)
               .lineTo(contentX + contentWidth, currentY)
               .stroke();
            doc.restore();

            currentY += 18;

            // Format Data Fields
            const transactionId = transaction.transactionId || 
                (transaction._id ? `VTN-${transaction._id.toString().slice(-8).toUpperCase()}` : 'VTN-6A7E-0676-');
            const referenceNumber = transaction.transactionReference || transaction.reference || '';
            const serviceName = this.formatService(transaction.service, transaction.product_name);
            const recipient = transaction.recipient || transaction.phone || (transaction.user && transaction.user.phone) || '';
            const dateTime = this.formatDateTime(transaction.paidAt || transaction.createdAt || transaction.transactionDate);
            const rawStatus = transaction.status || 'Success';

            // 5. Transaction Details Rows
            const rows = [
                { label: 'Transaction ID', value: transactionId },
                { label: 'Reference Number', value: referenceNumber },
                { label: 'Service', value: serviceName },
                { label: 'Recipient', value: recipient },
                { label: 'Date & Time', value: dateTime },
                { label: 'Status', value: rawStatus, isStatus: true }
            ];

            const rowHeight = 24;
            rows.forEach((row) => {
                // Label (Left)
                doc.fontSize(10.5)
                   .font('Helvetica')
                   .fillColor('#64748B')
                   .text(row.label, contentX, currentY, { width: contentWidth / 2, align: 'left' });

                // Value (Right)
                if (row.isStatus) {
                    const statusLower = (row.value || '').toLowerCase();
                    let statusColor = '#00D26A'; // Emerald Green for success
                    if (statusLower === 'pending') statusColor = '#F59E0B'; // Amber
                    if (statusLower === 'failed' || statusLower === 'declined') statusColor = '#EF4444'; // Red

                    const displayStatus = row.value.charAt(0).toUpperCase() + row.value.slice(1).toLowerCase();
                    doc.fontSize(11)
                       .font('Helvetica-Bold')
                       .fillColor(statusColor)
                       .text(displayStatus, contentX, currentY, { width: contentWidth, align: 'right' });
                } else {
                    if (row.value) {
                        doc.fontSize(11)
                           .font('Helvetica-Bold')
                           .fillColor('#FFFFFF')
                           .text(row.value, contentX, currentY, { width: contentWidth, align: 'right' });
                    }
                }

                currentY += rowHeight;
            });

            currentY += 6;

            // 6. Dashed Divider 2
            doc.save();
            doc.strokeColor('#1E293B')
               .lineWidth(1)
               .dash(2.5, { space: 3 })
               .moveTo(contentX, currentY)
               .lineTo(contentX + contentWidth, currentY)
               .stroke();
            doc.restore();

            currentY += 16;

            // 7. Total Paid Inset Card
            const totalBoxHeight = 56;
            const totalBoxY = currentY;

            doc.roundedRect(contentX, totalBoxY, contentWidth, totalBoxHeight, 14)
               .fillAndStroke('#0A0E1A', '#192234');

            // "TOTAL PAID" on left
            doc.fontSize(9.5)
               .font('Helvetica-Bold')
               .fillColor('#64748B')
               .text('TOTAL PAID', contentX + 16, totalBoxY + 22, { width: 120, align: 'left', characterSpacing: 0.8 });

            // "₦ Amount" on right
            const amountVal = Number(transaction.amount || 0);
            const formattedAmount = amountVal.toLocaleString('en-NG', {
                minimumFractionDigits: 0,
                maximumFractionDigits: 2
            });
            this.drawNairaText(doc, formattedAmount, contentX + contentWidth - 16, totalBoxY + 16, 20, '#FFFFFF');

            currentY = totalBoxY + totalBoxHeight + 24;

            // 8. Footer Notes
            doc.fontSize(8.5)
               .font('Helvetica')
               .fillColor('#64748B')
               .text('Thank you for using VtuNova. For support inquiries, contact', contentX, currentY, { align: 'center', width: contentWidth });

            currentY += 13;

            doc.fontSize(8.5)
               .font('Helvetica')
               .fillColor('#64748B')
               .text('help@vtunova.com', contentX, currentY, { align: 'center', width: contentWidth });

            doc.end();

            outputStream.on('finish', () => resolve());
            outputStream.on('error', (err) => reject(err));
        });
    }

    /**
     * Generate PDF as a Buffer
     */
    generateReceiptBuffer(transaction) {
        return new Promise((resolve, reject) => {
            const chunks = [];
            const doc = new PDFDocument({
                size: [380, 470],
                margins: { top: 0, bottom: 0, left: 0, right: 0 }
            });

            doc.on('data', (chunk) => chunks.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', (err) => reject(err));

            this.generateReceiptPDF(transaction, doc);
        });
    }
}

module.exports = new ReceiptService();
const logger = require('../utils/logger');

class NotificationFormatter {
     formatNotification(notification = {}) {
        const normalized = { ...notification };
        const resolvedType = this.determineType(normalized.type) || 'system';

        const title = this.writeTitle({ ...normalized, type: resolvedType });
        const message = this.writeMessage({ ...normalized, type: resolvedType }, normalized.ip, normalized.device);

        return {
            type: resolvedType,
            title: title || 'Notification',
            message: message || 'You have a new notification.',
            category: this.determineCategory(normalized.category),
            _id: normalized._id || 'not found'
        };
    }

    writeTitle(notification = {}) {
        if (notification.title && String(notification.title).trim()) {
            return String(notification.title).trim();
        }

        const checkType = this.determineType(notification.type) || 'system';
        const checkCategory = this.determineCategory(notification.category) || 'system';

        switch (checkType) {
            case 'security':
                return 'Security Alert';
            case 'loginAlert':
                return 'Login Alert';
            case 'transaction':
               if(checkCategory === 'airtime' || checkCategory === 'data' || checkCategory === 'electricity' || checkCategory === 'cable' && notification.status === 'pending') {
                    return `${checkCategory} Purchace`;
                }
                if(checkCategory === 'airtime' || checkCategory === 'data' || checkCategory === 'electricity' || checkCategory === 'cable' && notification.status === 'failed') {
                    return `${checkCategory} Purchace`;
                }
                if(checkCategory === 'airtime' || checkCategory === 'data' || checkCategory === 'electricity' || checkCategory === 'cable' && notification.status === 'success') {
                    return `${checkCategory} Purchace`;
                }
            case 'deposit':
                return 'Wallet Top-Up';
            case 'wallet':
                return 'Wallet Update';
            case 'system':
                return 'System Update';
            case 'airtime': 
                return 'Airtime Recharge';
            case 'data':
                return 'Data Bundle';
            case 'electricity':
                return 'Electricity Bill';
            case 'cable':
                return 'Cable TV';
            default:
                return 'Notification';
        }
    }

    writeMessage(notification = {}, ip, device) {
        if (notification.message && String(notification.message).trim()) {
            return String(notification.message).trim();
        }

        const checkType = this.determineType(notification.type) || 'system';
        const checkCategory = this.determineCategory(notification.category) || 'system';
        const safeIp = ip || notification.ip || 'unknown';
        const safeDevice = device || notification.device || 'unknown device';

        switch (checkType) {
            case 'security':
                if(checkCategory === 'loginAlert') {
                    return `A new login was detected from IP ${safeIp} using ${safeDevice}.`;
                }
                return 'A security alert has been posted for your account.';
            case 'loginAlert':
            
                return `A new login was detected from IP ${safeIp} using ${safeDevice}.`;
            case 'transaction':
                    if (checkCategory === 'airtime' || checkCategory === 'data' || checkCategory === 'electricity' || checkCategory === 'cable' && notification.status === 'pending') {
                        return `Your ${checkCategory} purchace${notification.amount ? ` for ₦${notification.amount}` : ''} is being processed.`;
                    }
                    if (checkCategory === 'airtime' || checkCategory === 'data' || checkCategory === 'electricity' || checkCategory === 'cable' && notification.status === 'failed') {
                        return `Your airtime purchace${notification.amount ? ` for ₦${notification.amount}` : ''} has failed.`;
                    }

                    if (checkCategory === 'airtime' || checkCategory === 'data' || checkCategory === 'electricity' || checkCategory === 'cable' && notification.status === 'success') {
                        return `Your airtime purchace${notification.amount ? ` for ₦${notification.amount}` : ''} has been completed.`;
                    }
            case 'wallet':
                return `Your wallet activity has been updated${notification.amount ? ` by ₦${notification.amount}` : ''}.`;
            case 'system':
                return 'A system update has been posted for your account.';
            default:
                return 'You have a new notification.';
        }
    }

    determineType(type) {
        if (!type) return 'system';

        const normalized = String(type).trim().toLowerCase();
        const typeMap = {
            security: 'security',
            login: 'loginAlert',
            loginalert: 'loginAlert',
            'login-alert': 'loginAlert',
            system: 'system',
            wallet: 'wallet',
            deposit: 'deposit',
            transaction: 'transaction',
            payment: 'transaction'
        };


        return typeMap[normalized] || normalized;
    }

    
        determineCategory = (category) => {
            const categoryMap = {
                security: 'security',
                login: 'loginAlert',
                loginalert: 'loginAlert',
                'login-alert': 'loginAlert',
                system: 'system',
                wallet: 'wallet',
                deposit: 'deposit',
                transaction: 'transaction',
                payment: 'transaction',
                airtime: 'airtime',
                data: 'data',
                electricity: 'electricity',
                cable: 'cable'
            };
            return categoryMap[category] || category;
        };
}

module.exports = new NotificationFormatter();
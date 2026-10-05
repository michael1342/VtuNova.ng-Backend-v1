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
            status: normalized.status,
            walletState: normalized.walletState,
            _id: normalized._id || 'not found',
            date: notification?.date,
            isRead: notification?.isRead
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
                if (['airtime', 'data', 'electricity', 'cable', 'vtu'].includes(checkCategory)) {
                    const service = checkCategory.charAt(0).toUpperCase() + checkCategory.slice(1);
                    const outcome = { pending: 'Processing', success: 'Successful',
                        failed: 'Failed', reversed: 'Reversed' }[notification.status];
                    return `${service} Purchase${outcome ? ` ${outcome}` : ''}`;
                }
                return 'Transaction Update';
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
                if (['airtime', 'data', 'electricity', 'cable', 'vtu'].includes(checkCategory)) {
                    const purchase = `Your ${checkCategory} purchase${notification.amount ? ` for ₦${notification.amount}` : ''}`;
                    if (notification.status === 'pending') return `${purchase} is being processed.`;
                    if (notification.status === 'success') return `${purchase} has been completed.`;
                    if (notification.status === 'failed') {
                        return `${purchase} could not be completed.${notification.walletState === 'refunded'
                            ? ' The amount has been returned to your VtuNova wallet.'
                            : notification.walletState === 'released' ? ' Your reserved funds have been released.' : ''}`;
                    }
                    if (notification.status === 'reversed') return `${purchase} has been reversed.`;
                }
                return 'Your transaction has been updated.';
            case 'deposit':
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

const useragent = require('useragent');

const getBrowser = (userAgent = '') => {
    if (/edg\//i.test(userAgent)) return 'Edge';
    if (/opr\//i.test(userAgent) || /opera/i.test(userAgent)) return 'Opera';
    if (/chrome\//i.test(userAgent)) return 'Chrome';
    if (/firefox\//i.test(userAgent)) return 'Firefox';
    if (/safari\//i.test(userAgent) && !/chrome\//i.test(userAgent)) return 'Safari';

    const agent = useragent.parse(userAgent);
    return agent.toAgent();
};

const getDevice = (userAgent = '') => {
    if (/iPad/i.test(userAgent)) return 'iPad';
    if (/iPhone/i.test(userAgent)) return 'iPhone';
    if (/Android/i.test(userAgent)) return /Mobile/i.test(userAgent) ? 'Android phone' : 'Android tablet';
    if (/Windows NT 10\.0/i.test(userAgent)) return 'Windows 10 PC';
    if (/Windows NT 6\.3/i.test(userAgent)) return 'Windows 8.1 PC';
    if (/Windows NT 6\.2/i.test(userAgent)) return 'Windows 8 PC';
    if (/Windows NT 6\.1/i.test(userAgent)) return 'Windows 7 PC';
    if (/Macintosh|Mac OS X/i.test(userAgent)) return 'Mac';
    if (/Linux/i.test(userAgent)) return 'Linux PC';

    const agent = useragent.parse(userAgent);
    return agent.device.toString();
};

module.exports = { getBrowser, getDevice };

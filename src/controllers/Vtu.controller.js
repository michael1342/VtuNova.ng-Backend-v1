    'use strict';

    const VtuService = require('../services/vtu.service');
    const logger = require('../utils/logger.js');

    //--------------SHARED: FORWARD ERRORS TO EXPRESS--------------//

    function forwardError(next, action, err) {
        // Raw Axios errors can contain provider credentials.
        // Log only selected diagnostic fields.
        try {
            logger.error(`VTU controller error: ${action}`, {
                code: err?.code,
                statusCode: err?.statusCode || err?.status,
            });
        } catch {
            // A logging failure must not hide the original request error.
        }

        return next(err);
    }

    //--------------SHARED: SEND PURCHASE OUTCOME--------------//

    function sendPurchase(res, Vtu) {
        // Pending purchases return 202.
        // Final outcomes return 200, including confirmed failures.
        // The frontend must inspect Vtu.status to determine the outcome.
        return res
            .status(Vtu.status === 'pending' ? 202 : 200)
            .json({ Vtu });
    }

    //--------------VTPASS: BUY AIRTIME--------------//

    exports.buyAirtime = async (req, res, next) => {
        try {
            const Vtu = await VtuService.Vtpass_buy_airtime(
                req.body,
                req
            );

            return sendPurchase(res, Vtu);
        } catch (err) {
            return forwardError(next, 'buyAirtime', err);
        }
    };

    //--------------VTPASS: BUY DATA--------------//

    exports.buyData = async (req, res, next) => {
        try {
            const Vtu = await VtuService.Vtpass_buy_data(
                req.body,
                req
            );

            return sendPurchase(res, Vtu);
        } catch (err) {
            return forwardError(next, 'buyData', err);
        }
    };

    //--------------VTPASS: GET DATA PLANS--------------//

    exports.getDataPlans = async (req, res, next) => {
        try {
            const Vtu = await VtuService.Vtpass_vtu_get(req.query);

            return res.status(200).json({ Vtu });
        } catch (err) {
            return forwardError(next, 'getDataPlans', err);
        }
    };

    //--------------VTPASS: VERIFY METER--------------//

    exports.verifyMeter = async (req, res, next) => {
        try {
            // The revised service returns data or throws an error.
            // Only the controller sends the HTTP response.
            const Vtu = await VtuService.vtpass_verify_meter_number(
                req.body
            );

            return res.status(200).json({ Vtu });
        } catch (err) {
            return forwardError(next, 'verifyMeter', err);
        }
    };

    //--------------VTPASS: BUY IKEJA ELECTRIC--------------//

    exports.byIkejaElectric = async (req, res, next) => {
        try {
            // Preserve the existing export name used by your routes.
            const Vtu = await VtuService.Vtpass_by_ikeja_electric(
                req.body,
                req
            );

            return sendPurchase(res, Vtu);
        } catch (err) {
            return forwardError(next, 'byIkejaElectric', err);
        }
    };

    //--------------QUICKTELLER: GET AIRTIME BILLERS--------------//

    exports.getQuicktellerAirtimeBillers = async (req, res, next) => {
        try {
            const Vtu = await VtuService.quickteller_get_airtime_billers();

            return res.status(200).json({ Vtu });
        } catch (err) {
            return forwardError(next, 'getQuicktellerAirtimeBillers', err);
        }
    };

    //--------------QUICKTELLER: BUY AIRTIME--------------//

    exports.buyQuicktellerAirtime = async (req, res, next) => {
        try {
            const Vtu = await VtuService.Quickteller_buy_airtime(
                req.body,
                req
            );

            return sendPurchase(res, Vtu);
        } catch (err) {
            return forwardError(next, 'buyQuicktellerAirtime', err);
        }
    };

    //--------------QUICKTELLER: READ CURRENT AIRTIME STATUS--------------//

    exports.checkQuicktellerAirtimeStatus = async (req, res, next) => {
        try {
            // Keep this route protected by authentication middleware.
            // Passing req lets the service verify transaction ownership.
            // This reads local status; the worker queries the provider.
            const Vtu = await VtuService.quickteller_check_airtime_status(
                req.params.requestReference,
                req
            );

            // Reading status successfully returns 200, even for pending purchases.
            return res.status(200).json({ Vtu });
        } catch (err) {
            return forwardError(next, 'checkQuicktellerAirtimeStatus', err);
        }
    };
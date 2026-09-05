const VtuService = require('../services/vtu.service')
const logger = require('../utils/logger.js')

exports.buyAirtime = async (req, res, next) => {
    try {
        const Vtu = await VtuService.Vtpass_buy_airtime(req.body, req)

       
        return res.status(200).json({ Vtu })
    } catch (err) {
        next(err)
        logger.error(`Error in buyAirtime: ${err.message}`, { error: err });
    }
}

exports.buyData = async (req, res, next) => {
    try {
        const Vtu = await VtuService.Vtpass_buy_data(req.body, req)

        return res.status(200).json({ Vtu })
    } catch (err) {
        next(err)
    }
}

exports.getDataPlans = async (req, res, next) => {
    try {
        const Vtu = await VtuService.Vtpass_vtu_get(req.query)

       
        return res.status(200).json({ Vtu })
    } catch (err) {
        next(err)
    }
}

exports.verifyMeter = async (req, res, next) => {
    try {
        const Vtu = await VtuService.vtpass_verify_meter_number(req.body, res)
        return res.status(200).json({ Vtu })
    } catch (err) {
        return res.status(500).json({ message: 'internal server error', error: err })
    }
}

exports.byIkejaElectric = async (req, res, next) => {
    try {
        const Vtu = await VtuService.Vtpass_by_ikeja_electric(req.body, req)
        return res.status(200).json({ Vtu })
    } catch (err) {
        next(err)
    }
}
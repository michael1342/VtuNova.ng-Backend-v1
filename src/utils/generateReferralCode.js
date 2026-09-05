const generateReferralCode = () => {
    const random = Math.floor(100000 + Math.random() * 900000);
    const fomarted = `VTN-RC-${random}`;
    return fomarted
}

module.exports = generateReferralCode
const crypto = require("crypto");

const generateReferralCode = (length = 8) => {
    return crypto
        .randomBytes(length)
        .toString("base64")
        .replace(/[^A-Z0-9]/gi, "")
        .substring(0, length)
        .toUpperCase();
};
module.exports = generateReferralCode;
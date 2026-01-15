const { validateFormData } = require("../../../utils/validateFormData");
const referralService = require("../../../services/admin/referrals/referralService");
const generateReferralCode = require("../../../utils/generateReferralCode");

const BASE_REFERRAL_URL =
    process.env.REFERRAL_BASE_URL || "https://samba-website.com/refer";

exports.createReferral = async (req, res) => {
    const formData = req.body;

    const validation = validateFormData(formData, {
        requiredFields: ["firstName", "lastName", "email"],
    });

    if (!validation.isValid) {
        return res.status(400).json({
            status: false,
            message: validation.message,
            error: validation.error,
        });
    }

    try {
        // 🔐 Generate random token
        const token = generateReferralCode(8);

        // 🔗 Build referral link
        formData.referralLink = `${BASE_REFERRAL_URL}/${token}`;

        // Website flow → no admin
        formData.referredBy = null;

        // 💾 Save
        const result = await referralService.createReferral(formData);

        if (!result.status) {
            return res.status(500).json({
                status: false,
                message: result.message,
            });
        }

        return res.status(201).json({
            status: true,
            message: "Referral created successfully.",
            data: result.data.toJSON(),
        });
    } catch (error) {
        console.error("❌ createReferral Error:", error);

        return res.status(500).json({
            status: false,
            message: "Server error while creating referral.",
        });
    }
};

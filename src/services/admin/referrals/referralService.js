const { Referral } = require("../../../models");

exports.createReferral = async (data) => {
    try {
        const referral = await Referral.create(data);

        return {
            status: true,
            message: "Referral created successfully.",
            data: referral, // ✅ RETURN INSTANCE
        };
    } catch (error) {
        console.error("❌ Sequelize Error in createReferral:", error);

        return {
            status: false,
            message:
                error?.parent?.sqlMessage ||
                error?.message ||
                "Failed to create referral.",
        };
    }
};

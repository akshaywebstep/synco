const { Referral } = require("../../../models");

exports.createReferral = async (data) => {
  try {
    const referral = await Referral.create(data);

    return {
      status: true,
      message: "Referral created successfully.",
      data: referral.toJSON(),
    };
  } catch (error) {
    console.error("❌ Sequelize Error in createReferral:", error);

    // 🔐 Duplicate referral (same parent + same email)
    if (error.name === "SequelizeUniqueConstraintError") {
      return {
        status: false,
        message: "You have already referred this email.",
      };
    }

    return {
      status: false,
      message:
        error?.parent?.sqlMessage ||
        error?.message ||
        "Failed to create referral.",
    };
  }
};
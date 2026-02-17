const { Referral, Admin, sequelize } = require("../../../models");

exports.listReferrals = async ({ adminId }) => {
  try {
    const referrals = await Referral.findAll({
      order: [["createdAt", "DESC"]],
      include: [
        {
          model: Admin,
          as: "referrer",
          required: true, // 🔥 IMPORTANT
          attributes: ["id", "firstName", "lastName", "email"],
          where: {
            createdByAdmin: adminId, // ✅ hierarchy filter
          },
        },
      ],
    });

    return {
      status: true,
      message: "Referrals fetched successfully.",
      data: {
        referrals,
      },
    };
  } catch (error) {
    console.error("❌ Sequelize Error in listReferrals:", error);

    return {
      status: false,
      message:
        error?.parent?.sqlMessage ||
        error?.message ||
        "Failed to fetch referrals.",
    };
  }
};

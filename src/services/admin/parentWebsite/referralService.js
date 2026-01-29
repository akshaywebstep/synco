const { Referral,Admin,sequelize } = require("../../../models");

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

;

exports.listReferrals = async ({ parentId, status }) => {
  try {
    const where = {};

    // 🔐 Logged-in parent/admin ke referrals
    if (parentId) {
      where.referredBy = parentId;
    }

    // 🔎 Optional status filter (list ke liye)
    if (status) {
      where.status = status;
    }

    // 🔹 Main list
    const referrals = await Referral.findAll({
      where,
      order: [["createdAt", "DESC"]],
      include: [
        {
          model: Admin,
          as: "referrer",
          attributes: ["id", "firstName", "lastName", "email"],
        },
      ],
    });

    // 🔹 Status counts (ALL statuses, filter se independent)
    const statusCountsRaw = await Referral.findAll({
      attributes: [
        "status",
        [sequelize.fn("COUNT", sequelize.col("status")), "count"],
      ],
      where: parentId ? { referredBy: parentId } : {},
      group: ["status"],
    });

    // 🔹 Normalize counts
    const statusCounts = {
      pending: 0,
      successful: 0,
      cancelled: 0,
    };

    statusCountsRaw.forEach((row) => {
      statusCounts[row.status] = Number(row.get("count"));
    });

    return {
      status: true,
      message: "Referrals fetched successfully.",
      data: {
        referrals,
        total: referrals.length,
        statusCounts, // ✅ NEW
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

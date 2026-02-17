const { Discount, DiscountAppliesTo, DiscountUsage, sequelize } = require("../../models");
const { Op } = require("sequelize");

// ✅ Get Discount By Code
const getDiscountByCode = async (code) => {
  try {
    const discount = await Discount.findOne({
      where: { code: { [Op.eq]: code } }
    });

    if (!discount) {
      return {
        status: false,
        message: `No discount found with code: ${code}`
      };
    }

    return {
      status: true,
      message: "Discount found.",
      data: discount
    };
  } catch (error) {
    console.error("❌ Sequelize Error in getDiscountByCode:", error);
    return {
      status: false,
      message: error?.parent?.sqlMessage || error?.message || "Error occurred while fetching discount by code."
    };
  }
};

// ✅ Create Discount
const createDiscount = async (data) => {
  try {
    const discountByCodeResult = await getDiscountByCode(data.code);
    if (discountByCodeResult.status) {
      return {
        status: false,
        message: "Code is already used."
      };
    }

    const discount = await Discount.create({
      type: data.type,
      code: data.code,
      valueType: data.valueType,
      value: data.value,
      applyOncePerOrder: data.applyOncePerOrder,
      limitTotalUses: data.limitTotalUses,
      limitPerCustomer: data.limitPerCustomer,
      startDatetime: data.startDatetime,
      endDatetime: data.endDatetime
    });

    if (Array.isArray(data.appliesTo)) {
      for (const item of data.appliesTo) {
        await DiscountAppliesTo.create({
          discountId: discount.id,
          target: item
        });
      }
    }

    return {
      status: true,
      message: "Discount created successfully.",
      data: discount
    };
  } catch (error) {
    console.error("❌ Sequelize Error in createDiscount:", error);
    return {
      status: false,
      message: error?.parent?.sqlMessage || error?.message || "Error occurred while creating the discount."
    };
  }
};

// ✅ Get existing appliesTo values for a discount
const getDiscountAppliedToByDiscountId = async (discountId) => {
  try {
    const records = await DiscountAppliesTo.findAll({
      where: { discountId },
      attributes: ["target"]
    });

    return {
      status: true,
      data: records
    };
  } catch (error) {
    console.error("❌ Sequelize Error in getDiscountAppliedToByDiscountId:", error);
    return [];
  }
};

// ✅ Create a new DiscountAppliesTo entry
const createDiscountAppliesTo = async ({ discountId, target }) => {
  try {
    const created = await DiscountAppliesTo.create({
      discountId,
      target
    });

    return {
      status: true,
      message: "Discount target applied successfully.",
      data: created
    };
  } catch (error) {
    console.error("❌ Sequelize Error in createDiscountAppliesTo:", error);
    return {
      status: false,
      message: error?.parent?.sqlMessage || error?.message || "Error occurred while applying discount target."
    };
  }
};

// ✅ Get All Discounts with Usage Count
const getAllDiscounts = async () => {
  try {
    const discounts = await Discount.findAll({
      order: [["createdAt", "DESC"]],
      include: [
        {
          model: DiscountAppliesTo,
          as: "appliesTo",
          attributes: ["id", "target"],
        },
        {
          model: DiscountUsage,
          as: "usages",
          attributes: [], // we only need count, no full rows
        },
      ],
      attributes: {
        include: [
          [
            sequelize.fn("COUNT", sequelize.col("usages.id")),
            "usageCount"
          ]
        ]
      },
      group: ["Discount.id", "appliesTo.id"], // required for COUNT()
    });

    if (!discounts || discounts.length === 0) {
      return {
        status: true,
        message: "No discounts found.",
        data: [],
      };
    }

    const now = new Date();

    // 🔥 Add computed "status" field
    const formatted = discounts.map((discount) => {
      const json = discount.toJSON();
      const usageCount = json.usageCount || 0;

      const end = new Date(json.endDatetime);

      const isExpired =
        end < now ||
        (json.limitTotalUses !== null &&
          usageCount >= json.limitTotalUses);

      return {
        ...json,
        usageCount,
        status: isExpired ? "expired" : "active",
      };
    });

    return {
      status: true,
      message: "Discounts fetched successfully with status and usage count.",
      data: formatted,
    };
  } catch (error) {
    console.error("❌ Sequelize Error in getAllDiscounts:", error);
    return {
      status: false,
      message:
        error?.parent?.sqlMessage ||
        error?.message ||
        "Error occurred while fetching discounts.",
    };
  }
};

module.exports = {
  getDiscountByCode,
  createDiscount,
  getDiscountAppliedToByDiscountId,
  createDiscountAppliesTo,
  getAllDiscounts
};

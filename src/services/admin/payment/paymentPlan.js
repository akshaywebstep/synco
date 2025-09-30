const PaymentPlan = require("../../../models/admin/payment/PaymentPlan");
const { Op } = require("sequelize");

// ✅ Create a new payment plan
exports.createPlan = async (data) => {
  try {
    const {
      title,
      price,
      priceLesson,
      interval,
      duration,
      students,
      joiningFee,
      HolidayCampPackage,
      termsAndCondition,
      createdBy,
    } = data;

    const plan = await PaymentPlan.create({
      title,
      price,
      priceLesson,
      interval,
      duration,
      students,
      joiningFee,
      HolidayCampPackage,
      termsAndCondition,
      createdBy,
    });

    return {
      status: true,
      data: plan,
      message: "Payment plan created successfully.",
    };
  } catch (error) {
    console.error("❌ createPlan error:", error.message);
    return {
      status: false,
      message: `Failed to create payment plan. ${error.message}`,
    };
  }
};

// ✅ Get all payment plans for current admin
exports.getAllPlans = async (createdBy) => {
  try {
    const plans = await PaymentPlan.findAll({
      where: { createdBy },
      order: [["createdAt", "DESC"]],
    });

    return {
      status: true,
      data: plans,
      message: `${plans.length} payment plan(s) found.`,
    };
  } catch (error) {
    return {
      status: false,
      message: `Failed to fetch payment plans. ${error.message}`,
    };
  }
};

// ✅ Get payment plan by ID and createdBy
exports.getPlanById = async (id, createdBy) => {
  try {
    const plan = await PaymentPlan.findOne({
      where: { id, createdBy },
    });

    if (!plan) {
      return {
        status: false,
        message: "No payment plan found with the provided ID.",
      };
    }

    return {
      status: true,
      data: plan,
      message: "Payment plan retrieved successfully.",
    };
  } catch (error) {
    return {
      status: false,
      message: `Error fetching payment plan. ${error.message}`,
    };
  }
};

// ✅ Update a payment plan by ID and createdBy
exports.updatePlan = async (id, adminId, data) => {
  try {
    const plan = await PaymentPlan.findOne({
      where: { id, createdBy: adminId },
    });

    if (!plan) {
      return {
        status: false,
        message: "Cannot update. Payment plan not found.",
      };
    }

    await plan.update(data);

    return {
      status: true,
      data: plan,
      message: "Payment plan updated successfully.",
    };
  } catch (error) {
    return {
      status: false,
      message: `Failed to update payment plan. ${error.message}`,
    };
  }
};

// ✅ Delete a payment plan by ID and createdBy
exports.deletePlan = async (id, createdBy) => {
  try {
    const plan = await PaymentPlan.findOne({
      where: { id, createdBy },
    });

    if (!plan) {
      return {
        status: false,
        message: "Cannot delete. Payment plan not found.",
      };
    }

    await plan.destroy();

    return {
      status: true,
      message: "Payment plan deleted successfully.",
    };
  } catch (error) {
    return {
      status: false,
      message: `Failed to delete payment plan. ${error.message}`,
    };
  }
};

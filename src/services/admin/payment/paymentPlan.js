const PaymentPlan = require("../../../models/admin/payment/PaymentPlan");
const { Op } = require("sequelize");
const {Admin} = require("../../../models");
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
exports.getAllPlans = async (superAdminId, adminId) => {
  try {

    const currentAdmin = await Admin.findByPk(adminId);

    let whereCondition = {};

    // ✅ If superAdminId is null → This is SuperAdmin
    if (!currentAdmin.superAdminId) {
      // get all child admins/franchisee
      const childAdmins = await Admin.findAll({
        where: { superAdminId: Number(adminId) },
        attributes: ["id"],
      });

      const childIds = childAdmins.map(a => a.id);

      childIds.push(Number(adminId)); // include self

      whereCondition.createdBy = childIds;
    } 
    else {
      // ✅ Normal Admin / Franchisee → only own data
      whereCondition.createdBy = Number(adminId);
    }

    const plans = await PaymentPlan.findAll({
      where: whereCondition,
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
exports.getPlanById = async (id, adminId) => {
  try {
    if (!adminId || isNaN(Number(adminId))) {
      return {
        status: false,
        message: "Invalid admin ID.",
        data: [],
      };
    }

    const currentAdmin = await Admin.findByPk(adminId);

    if (!currentAdmin) {
      return {
        status: false,
        message: "Admin not found.",
      };
    }

    let whereCondition = { id };

    // ✅ SuperAdmin (superAdminId null)
    if (!currentAdmin.superAdminId) {

      const childAdmins = await Admin.findAll({
        where: { superAdminId: Number(adminId) },
        attributes: ["id"],
      });

      const childIds = childAdmins.map(a => a.id);
      childIds.push(Number(adminId));

      whereCondition.createdBy = childIds;
    } 
    else {
      // ✅ Normal Admin / Franchisee
      whereCondition.createdBy = Number(adminId);
    }

    const plan = await PaymentPlan.findOne({
      where: whereCondition,
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

// exports.getPlanById = async (id, adminId) => {
//   try {
//     if (!adminId || isNaN(Number(adminId))) {
//       return {
//         status: false,
//         message: "No valid parent or super admin found for this request.",
//         data: [],
//       };
//     }
//     const plan = await PaymentPlan.findOne({
//       where: { id, createdBy: Number(adminId) },
//     });

//     if (!plan) {
//       return {
//         status: false,
//         message: "No payment plan found with the provided ID. (1)",
//       };
//     }

//     return {
//       status: true,
//       data: plan,
//       message: "Payment plan retrieved successfully.",
//     };
//   } catch (error) {
//     return {
//       status: false,
//       message: `Error fetching payment plan. ${error.message}`,
//     };
//   }
// };

// Public lookup
exports.getPublicPlanById = async (id) => {
  try {
    const plan = await PaymentPlan.findOne({
      where: { id }, // no status check
    });

    if (!plan) {
      return {
        message: "No payment plan found with the provided ID.",
        data: null,
      };
    }

    return {
      message: "Payment plan retrieved successfully.",
      data: plan,
    };
  } catch (error) {
    return {
      message: error.message,
      data: null,
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

// // ✅ Delete a payment plan by ID and createdBy
// exports.deletePlan = async (id, createdBy) => {
//   try {
//     const plan = await PaymentPlan.findOne({
//       where: { id, createdBy },
//     });

//     if (!plan) {
//       return {
//         status: false,
//         message: "Cannot delete. Payment plan not found.",
//       };
//     }

//     await plan.destroy();

//     return {
//       status: true,
//       message: "Payment plan deleted successfully.",
//     };
//   } catch (error) {
//     return {
//       status: false,
//       message: `Failed to delete payment plan. ${error.message}`,
//     };
//   }
// };

// ✅ Soft delete a payment plan by ID (restricted by createdBy/admin)
exports.deletePlan = async (id, deletedBy) => {
  try {
    // ✅ Find plan owned by this admin and not already deleted
    const plan = await PaymentPlan.findOne({
      where: { id, createdBy: deletedBy, deletedAt: null },
    });

    if (!plan) {
      return {
        status: false,
        message: "Payment plan not found or unauthorized.",
      };
    }

    // ✅ Track who deleted
    await plan.update({ deletedBy });

    // ✅ Soft delete (sets deletedAt automatically)
    await plan.destroy();

    return {
      status: true,
      message: "Payment plan deleted successfully.",
    };
  } catch (error) {
    console.error("❌ deletePlan Service Error:", error);
    return {
      status: false,
      message: `Failed to  delete payment plan. ${error.message}`,
    };
  }
};

const PaymentGroup = require("../../../models/admin/payment/PaymentGroup");
const PaymentGroupHasPlan = require("../../../models/admin/payment/PaymentGroupHasPlan");

// ✅ Assign a plan to a group
exports.assignPlanToPaymentGroup = async (groupId, planId, createdBy) => {
  try {
    const group = await PaymentGroup.findOne({
      where: { id: groupId, createdBy },
    });

    if (!group) {
      return {
        status: false,
        message: "Payment group not found or access denied.",
      };
    }

    // Remove existing mapping (if any)
    await PaymentGroupHasPlan.destroy({
      where: {
        payment_group_id: groupId,
        payment_plan_id: planId,
        createdBy,
      },
    });

    // Create new mapping
    const created = await PaymentGroupHasPlan.create({
      payment_group_id: groupId,
      payment_plan_id: planId,
      createdBy,
    });

    return {
      status: true,
      data: created,
      message: `Plan ID ${planId} successfully assigned to Group ID ${groupId}.`,
    };
  } catch (error) {
    console.error("❌ assignPlanToPaymentGroup error:", error);
    return {
      status: false,
      message: "Failed to assign plan to group.",
      error: error.message,
    };
  }
};

// ✅ Remove a plan from a group
exports.removePlanFromPaymentGroup = async (groupId, planId, createdBy) => {
  try {
    const group = await PaymentGroup.findOne({
      where: { id: groupId, createdBy },
    });

    if (!group) {
      return {
        status: false,
        message: "Payment group not found or access denied.",
      };
    }

    const deletedCount = await PaymentGroupHasPlan.destroy({
      where: {
        payment_group_id: groupId,
        payment_plan_id: planId,
        createdBy,
      },
    });

    if (deletedCount === 0) {
      return {
        status: false,
        message: `No matching plan (ID: ${planId}) found for group (ID: ${groupId}).`,
      };
    }

    return {
      status: true,
      message: `Plan ID ${planId} removed from Group ID ${groupId} successfully.`,
    };
  } catch (error) {
    console.error("❌ removePlanFromPaymentGroup error:", error);
    return {
      status: false,
      message: "Failed to remove plan from group.",
      error: error.message,
    };
  }
};

// ✅ Get all assigned plan IDs for a group
exports.getPaymentGroupAssignedPlans = async (groupId, createdBy) => {
  try {
    const group = await PaymentGroup.findOne({
      where: { id: groupId, createdBy },
    });

    if (!group) {
      return {
        status: false,
        message: "Payment group not found or access denied.",
      };
    }

    const assignedPlans = await PaymentGroupHasPlan.findAll({
      where: {
        payment_group_id: groupId,
        createdBy,
      },
      attributes: ["payment_plan_id"],
    });

    const planIds = assignedPlans.map((item) => item.payment_plan_id);

    return {
      status: true,
      data: planIds,
    };
  } catch (error) {
    console.error("❌ getPaymentGroupAssignedPlans error:", error);
    return {
      status: false,
      message: "Failed to fetch assigned plans.",
      error: error.message,
    };
  }
};
// exports.getPaymentGroupAssignedPlans = async (groupId, createdBy) => {
//   try {
//     const group = await PaymentGroup.findOne({
//       where: { id: groupId, createdBy },
//     });

//     if (!group) {
//       return {
//         status: false,
//         message: "Payment group not found or access denied.",
//       };
//     }

//     const assignedPlans = await PaymentGroupHasPlan.findAll({
//       where: { payment_group_id: groupId, createdBy },
//       attributes: ["payment_plan_id"],
//     });

//     const planIds = assignedPlans.map((item) => item.payment_plan_id);

//     return {
//       status: true,
//       data: planIds,
//     };
//   } catch (error) {
//     console.error("❌ getPaymentGroupAssignedPlans error:", error);
//     return {
//       status: false,
//       message: "Failed to fetch assigned plans.",
//       error: error.message,
//     };
//   }
// };

// exports.assignPlanToPaymentGroup = async (groupId, planId, createdBy) => {
//   try {
//     const group = await PaymentGroup.findOne({
//       where: { id: groupId, createdBy },
//     });
//     if (!group) {
//       return {
//         status: false,
//         message: "Payment group not found or access denied.",
//       };
//     }

//     const plan = await PaymentPlan.findByPk(planId);
//     if (!plan) {
//       return {
//         status: false,
//         message: "Payment plan not found.",
//       };
//     }

//     const existing = await PaymentGroupHasPlan.findOne({
//       where: { payment_group_id: groupId, payment_plan_id: planId },
//     });

//     if (existing) {
//       return {
//         status: true,
//         message: "Plan already assigned to group.",
//       };
//     }

//     await PaymentGroupHasPlan.create({
//       payment_group_id: groupId,
//       payment_plan_id: planId,
//       createdBy,
//     });

//     return {
//       status: true,
//       message: "Plan assigned successfully.",
//     };
//   } catch (error) {
//     console.error("❌ assignPlanToPaymentGroup error:", error);
//     return {
//       status: false,
//       message: "Failed to assign plan to group.",
//       error: error.message,
//     };
//   }
// };

// exports.removePlanFromPaymentGroup = async (groupId, planId, createdBy) => {
//   try {
//     const group = await PaymentGroup.findOne({
//       where: { id: groupId, createdBy },
//     });
//     if (!group) {
//       return {
//         status: false,
//         message: "Payment group not found or access denied.",
//       };
//     }

//     const removed = await PaymentGroupHasPlan.destroy({
//       where: {
//         payment_group_id: groupId,
//         payment_plan_id: planId,
//         createdBy,
//       },
//     });

//     if (removed === 0) {
//       return {
//         status: false,
//         message: "Plan not found in group or already removed.",
//       };
//     }

//     return {
//       status: true,
//       message: "Plan removed successfully.",
//     };
//   } catch (error) {
//     console.error("❌ removePlanFromPaymentGroup error:", error);
//     return {
//       status: false,
//       message: "Failed to remove plan from group.",
//       error: error.message,
//     };
//   }
// };

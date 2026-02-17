const { HolidayPaymentGroup, HolidayPaymentPlan } = require("../../../../models");
const { Op } = require("sequelize");
const HolidayPaymentGroupHasPlan = require("../../../../models/admin/holidayCamps/payment/HolidayPaymentGroupHasPlan");

// ✅ Create a group
exports.createHolidayPaymentGroup = async ({ name, description, createdBy }) => {
  try {
    const group = await HolidayPaymentGroup.create({
      name,
      description,
      createdBy,
    });

    return {
      status: true,
      data: group,
      message: "Payment group created successfully.",
    };
  } catch (error) {
    return {
      status: false,
      message: `Unable to create payment group. ${error.message}`,
    };
  }
};

exports.getAllHolidayPaymentGroups = async (adminId) => {
  try {
    if (!adminId || isNaN(Number(adminId))) {
      return {
        status: false,
        message: "No valid parent or super admin found for this request.",
        data: [],
      };
    }

    const groups = await HolidayPaymentGroup.findAll({
      where: { createdBy: Number(adminId) },
      include: [
        {
          model: HolidayPaymentPlan,
          as: "holidayPaymentPlans",
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    return {
      status: true,
      message: "Payment groups fetched successfully",
      data: groups,
    };
  } catch (error) {
    console.error("❌ Error in getAllPaymentGroups:", error);
    return {
      status: false,
      message: "Failed to fetch payment groups",
      error,
    };
  }
};

exports.getHolidayPaymentGroupById = async (id, adminId) => {
  try {
    if (!adminId || isNaN(Number(adminId))) {
      return {
        status: false,
        message: "No valid parent or super admin found for this request.",
        data: [],
      };
    }

    const group = await HolidayPaymentGroup.findOne({
      where: { id, createdBy: Number(adminId) },
      include: [
        {
          model: HolidayPaymentPlan,
          as: "holidayPaymentPlans",
        },
      ],
    });

    if (!group) {
      return {
        status: false,
        message: "Payment group not found",
      };
    }

    return {
      status: true,
      message: "Payment group fetched successfully",
      data: group,
    };
  } catch (error) {
    console.error("❌ Error in getPaymentGroupById:", error);
    return {
      status: false,
      message: "Failed to fetch payment group",
      error,
    };
  }
};

// ✅ Update a payment group by ID and createdBy
exports.updateHolidayPaymentGroup = async (id, createdBy, { name, description }) => {
  try {
    if (!id || !createdBy) {
      return {
        status: false,
        message: "Missing payment group ID or admin ID (createdBy).",
      };
    }

    const group = await HolidayPaymentGroup.findOne({
      where: { id, createdBy },
    });

    if (!group) {
      return {
        status: false,
        message: "Cannot update. Payment group not found.",
      };
    }

    await group.update({ name, description });

    return {
      status: true,
      data: group,
      message: "Payment group updated successfully.",
    };
  } catch (error) {
    console.error("❌ Error updating payment group:", error);
    return {
      status: false,
      message: `Failed to update payment group. ${error.message}`,
    };
  }
};

// ✅ Delete a group by ID and createdBy
// exports.deletePaymentGroup = async (id, createdBy) => {
//   try {
//     const group = await PaymentGroup.findOne({
//       where: { id, createdBy },
//     });

//     if (!group) {
//       return {
//         status: false,
//         message: "Cannot delete. Payment group not found.",
//       };
//     }

//     await group.destroy();

//     return {
//       status: true,
//       message: "Payment group deleted successfully.",
//     };
//   } catch (error) {
//     return {
//       status: false,
//       message: `Failed to delete group. ${error.message}`,
//     };
//   }
// };

// ✅ Soft delete a payment group by ID (no unlinking)
exports.deleteHolidayPaymentGroup = async (id, deletedBy) => {
  try {
    // ✅ Find the group owned by this admin and not already deleted
    const group = await HolidayPaymentGroup.findOne({
      where: { id, createdBy: deletedBy, deletedAt: null },
    });

    if (!group) {
      return {
        status: false,
        message: "Payment group not found or unauthorized.",
      };
    }

    // ✅ Record who deleted the group
    await group.update({ deletedBy });

    // ✅ Soft delete (requires paranoid: true in model)
    await group.destroy();

    return {
      status: true,
      message: "Payment group deleted successfully.",
    };
  } catch (error) {
    console.error("❌ Error in deletePaymentGroup Service:", error);
    return {
      status: false,
      message: `Failed to  delete group. ${error.message}`,
    };
  }
};

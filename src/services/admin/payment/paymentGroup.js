const { PaymentGroup, PaymentPlan, Admin } = require("../../../models");
const { Op } = require("sequelize");

// ✅ Create a group
exports.createPaymentGroup = async ({ name, description, createdBy }) => {
  try {
    const group = await PaymentGroup.create({
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

exports.getAllPaymentGroups = async (adminId) => {
  try {
    if (!adminId || isNaN(Number(adminId))) {
      return {
        status: false,
        message: "Invalid admin ID",
        data: [],
      };
    }

    const currentAdmin = await Admin.findByPk(adminId);

    if (!currentAdmin) {
      return {
        status: false,
        message: "Admin not found",
        data: [],
      };
    }

    let whereCondition = {};

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
      // ✅ Admin / Franchisee
      whereCondition.createdBy = Number(adminId);
    }

    const groups = await PaymentGroup.findAll({
      where: whereCondition,
      include: [
        {
          model: PaymentPlan,
          as: "paymentPlans",
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
    };
  }
};

exports.getPaymentGroupById = async (id, adminId) => {
  try {
    if (!adminId || isNaN(Number(adminId))) {
      return {
        status: false,
        message: "No valid parent or super admin found for this request.",
        data: [],
      };
    }

    const currentAdmin = await Admin.findByPk(adminId);

    let whereCondition = { id };

    // ✅ SuperAdmin (superAdminId null)
    if (currentAdmin && !currentAdmin.superAdminId) {
      const childAdmins = await Admin.findAll({
        where: { superAdminId: Number(adminId) },
        attributes: ["id"],
      });

      const childIds = childAdmins.map(a => a.id);
      childIds.push(Number(adminId));

      whereCondition.createdBy = childIds;
    } else {
      // ✅ Normal Admin / Franchisee
      whereCondition.createdBy = Number(adminId);
    }

    const group = await PaymentGroup.findOne({
      where: whereCondition,
      include: [
        {
          model: PaymentPlan,
          as: "paymentPlans",
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
exports.updatePaymentGroup = async (id, createdBy, { name, description }) => {
  try {
    if (!id || !createdBy) {
      return {
        status: false,
        message: "Missing payment group ID or admin ID (createdBy).",
      };
    }

    const group = await PaymentGroup.findOne({
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
exports.deletePaymentGroup = async (id, deletedBy) => {
  try {
    // ✅ Find the group owned by this admin and not already deleted
    const group = await PaymentGroup.findOne({
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

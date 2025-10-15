const {
  Admin,
  AdminRole,
  Country,
  State,
  City,
  AdminRolePermission,
  PaymentGroup,
  PaymentPlan,
  PaymentGroupHasPlan,
  SessionPlanGroup,
  SessionExercise,
  TermGroup,
  Term,
  Venue,
  ClassSchedule,
  Booking,
  Lead,
  CancelSession,
  ClassScheduleTermMap
} = require("../../models");
const DEBUG = process.env.DEBUG === "true";

const { Op } = require("sequelize");

// Create admin
exports.createAdmin = async (data) => {
  try {
    const admin = await Admin.create(data);

    return {
      status: true,
      message: "Admin created successfully.",
      data: admin,
    };
  } catch (error) {
    console.error("❌ Sequelize Error in createAdmin:", error);

    return {
      status: false,
      message:
        error?.parent?.sqlMessage ||
        error?.message ||
        "Failed to create admin.",
    };
  }
};

// Find admin by email
exports.findAdminByEmail = async (email) => {
  try {
    const admin = await Admin.findOne({
      where: { email },
      include: [
        {
          model: AdminRole,
          as: "role",
          attributes: ["id", "role"],
          include: [
            {
              model: AdminRolePermission,
              as: "permissions",
              attributes: ["id", "module", "action", "status"],
              through: { attributes: [] },
            },
          ],
        },
      ],
    });

    if (!admin) {
      return {
        status: false,
        message: "Admin not found with this email.",
      };
    }

    return {
      status: true,
      message: "Admin found.",
      data: admin,
    };
  } catch (error) {
    console.error("❌ Sequelize Error in findAdminByEmail:", error);

    return {
      status: false,
      message:
        error?.parent?.sqlMessage ||
        error?.message ||
        "Error occurred while finding admin.",
    };
  }
};

// Get admin by ID
exports.getAdminById = async (id) => {
  try {
    const admin = await Admin.findOne({
      where: { id },
      attributes: {
        exclude: ["password", "resetOtp", "resetOtpExpiry"],
      },
      include: [
        {
          model: AdminRole,
          as: "role",
          attributes: ["id", "role"],
        },
        {
          model: Country,
          as: "country",
          attributes: ["id", "name"],
        },
        /*
            {
                model: State,
                as: 'state',
                attributes: ['id', 'name'],
            },
            {
                model: City,
                as: 'city',
                attributes: ['id', 'name'],
            },
        */
      ],
    });

    if (!admin) {
      return {
        status: false,
        message: "Admin not found by ID.",
      };
    }

    return {
      status: true,
      message: "Admin found.",
      data: admin,
    };
  } catch (error) {
    console.error("❌ Sequelize Error in getAdminById:", error);

    return {
      status: false,
      message:
        error?.parent?.sqlMessage ||
        error?.message ||
        "Error occurred while fetching admin.",
    };
  }
};

// Update admin fields by ID
exports.updateAdmin = async (adminId, updateData) => {
  try {
    const result = await Admin.update(updateData, {
      where: { id: adminId },
    });

    if (result[0] === 0) {
      return {
        status: false,
        message: "No admin updated. ID may be incorrect.",
      };
    }

    return {
      status: true,
      message: "Admin updated successfully.",
    };
  } catch (error) {
    console.error("❌ Sequelize Error in updateAdmin:", error);

    return {
      status: false,
      message:
        error?.parent?.sqlMessage ||
        error?.message ||
        "Failed to update admin.",
    };
  }
};

// Get all admins
exports.getAllAdmins = async () => {
  try {
    const admins = await Admin.findAll({
      attributes: { exclude: ["password", "resetOtp", "resetOtpExpiry"] },
      include: [
        {
          model: AdminRole,
          as: "role",
          attributes: ["id", "role"],
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    return {
      status: true,
      message: `Fetched ${admins.length} admin(s) successfully.`,
      data: admins,
    };
  } catch (error) {
    console.error("❌ Sequelize Error in getAllAdmins:", error);

    return {
      status: false,
      message:
        error?.parent?.sqlMessage ||
        error?.message ||
        "Failed to fetch admins.",
    };
  }
};

// Update password by admin ID
exports.updatePasswordById = async (id, newPassword) => {
  try {
    const result = await Admin.update(
      { password: newPassword },
      { where: { id } }
    );

    if (result[0] === 0) {
      return {
        status: false,
        message: "No admin updated. ID may be incorrect.",
      };
    }

    return {
      status: true,
      message: "Password updated successfully.",
    };
  } catch (error) {
    console.error("❌ Sequelize Error in updatePasswordById:", error);

    return {
      status: false,
      message:
        error?.parent?.sqlMessage ||
        error?.message ||
        "Error updating password.",
    };
  }
};

// Save OTP to admin
// exports.saveOtpToAdmin = async (adminId, otp, expiry) => {
//   try {
//     const result = await Admin.update(
//       {
//         resetOtp: otp,
//         resetOtpExpiry: expiry,
//       },
//       {
//         where: { id: adminId },
//       }
//     );

//     if (result[0] === 0) {
//       return {
//         status: false,
//         message: "Failed to save OTP. Admin not found.",
//       };
//     }

//     return {
//       status: true,
//       message: "OTP saved successfully.",
//     };
//   } catch (error) {
//     console.error("❌ Sequelize Error in saveOtpToAdmin:", error);

//     return {
//       status: false,
//       message:
//         error?.parent?.sqlMessage || error?.message || "Error saving OTP.",
//     };
//   }
// };

// Find admin by email and valid OTP
// exports.findAdminByEmailAndValidOtp = async (email, otp) => {
//   try {
//     const admin = await Admin.findOne({
//       where: {
//         email,
//         resetOtp: otp,
//         resetOtpExpiry: {
//           [Op.gt]: new Date(),
//         },
//       },
//     });

//     if (!admin) {
//       return {
//         status: false,
//         message: "Invalid or expired OTP.",
//       };
//     }

//     return {
//       status: true,
//       message: "Valid OTP found.",
//       data: admin,
//     };
//   } catch (error) {
//     console.error("❌ Sequelize Error in findAdminByEmailAndValidOtp:", error);

//     return {
//       status: false,
//       message:
//         error?.parent?.sqlMessage || error?.message || "Error validating OTP.",
//     };
//   }
// };

exports.saveResetTokenToAdmin = async (adminId, token, expiry) => {
  try {
    const result = await Admin.update(
      {
        resetToken: token,
        resetTokenExpiry: expiry,
      },
      {
        where: { id: adminId },
      }
    );

    if (result[0] === 0) {
      return {
        status: false,
        message: "Admin not found.",
      };
    }

    return {
      status: true,
      message: "Reset token saved.",
    };
  } catch (error) {
    console.error("❌ Error saving reset token:", error);
    return {
      status: false,
      message: "Failed to save reset token.",
    };
  }
};
exports.findAdminByValidResetToken = async (token) => {
  console.log("🔍 Verifying reset token...");
  console.log("🕐 Current Time:", new Date());
  console.log("🔑 Received Token:", token);

  try {
    const admin = await Admin.findOne({
      where: {
        resetToken: token,
        resetTokenExpiry: {
          [Op.gt]: new Date(), // Token must not be expired
        },
      },
    });

    if (!admin) {
      console.log("❌ Token not found or expired.");
      return {
        status: false,
        message: "Invalid or expired reset token.",
      };
    }

    console.log("✅ Valid token found for admin:", admin.email);

    return {
      status: true,
      message: "Reset token is valid.",
      data: admin,
    };
  } catch (error) {
    console.error("❌ Error validating reset token:", error);
    return {
      status: false,
      message: "Failed to validate reset token.",
    };
  }
};

exports.updatePasswordAndClearResetToken = async (adminId, hashedPassword) => {
  try {
    const result = await Admin.update(
      {
        password: hashedPassword,
        resetToken: null,
        resetTokenExpiry: null,
      },
      {
        where: { id: adminId },
      }
    );

    if (result[0] === 0) {
      return {
        status: false,
        message: "Failed to reset password. Admin not found.",
      };
    }

    return {
      status: true,
      message: "Password updated and token cleared.",
    };
  } catch (error) {
    console.error("❌ Error updating password:", error);
    return {
      status: false,
      message: "Failed to update password.",
    };
  }
};
// Update password and clear OTP fields
// exports.updatePasswordAndClearOtp = async (adminId, hashedPassword) => {
//   try {
//     const result = await Admin.update(
//       {
//         password: hashedPassword,
//         resetOtp: null,
//         resetOtpExpiry: null,
//       },
//       {
//         where: { id: adminId },
//       }
//     );

//     if (result[0] === 0) {
//       return {
//         status: false,
//         message: "Failed to update password. Admin not found.",
//       };
//     }

//     return {
//       status: true,
//       message: "Password updated and OTP cleared.",
//     };
//   } catch (error) {
//     console.error("❌ Sequelize Error in updatePasswordAndClearOtp:", error);

//     return {
//       status: false,
//       message:
//         error?.parent?.sqlMessage ||
//         error?.message ||
//         "Error updating password and clearing OTP.",
//     };
//   }
// };

// Delete admin by ID
// exports.deleteAdmin = async (id, currentAdminId) => {
//   try {
//     // Prevent deleting own account
//     if (parseInt(id) === parseInt(currentAdminId)) {
//       return {
//         status: false,
//         message: "You cannot delete your own account while logged in.",
//       };
//     }

//     // ✅ Soft delete and set deletedBy
//     const result = await Admin.update(
//       { deletedBy: currentAdminId }, // track who deleted
//       { where: { id } }
//     );

//     // Perform soft delete
//     const destroyed = await Admin.destroy({
//       where: { id }, // will set deletedAt because paranoid: true
//     });

//     if (destroyed === 0) {
//       return {
//         status: false,
//         message: "No admin deleted. The provided ID may be incorrect.",
//       };
//     }

//     return {
//       status: true,
//       message: "Admin account deleted successfully.",
//     };
//   } catch (error) {
//     console.error("❌ Sequelize Error in deleteAdmin:", error);

//     return {
//       status: false,
//       message:
//         error?.parent?.sqlMessage ||
//         error?.message ||
//         "Failed to delete admin.",
//     };
//   }
// };

//  delte

exports.deleteAdmin = async (id, transferToAdminId) => {
  try {
    if (!id) throw new Error("Admin ID is required");

    // Fetch admin to delete
    const adminToDelete = await Admin.findByPk(id);
    if (!adminToDelete) {
      return { status: false, message: "Admin not found" };
    }

    if (transferToAdminId) {
      // 🔹 Reassign related data to another admin
      if (DEBUG) console.log(`🔄 Reassigning related data to admin ${transferToAdminId}...`);

      await Promise.all([
        PaymentGroup.update({ createdBy: transferToAdminId }, { where: { createdBy: id } }),
        PaymentGroupHasPlan.update({ createdBy: transferToAdminId }, { where: { createdBy: id } }),
        PaymentPlan.update({ createdBy: transferToAdminId }, { where: { createdBy: id } }),
        SessionPlanGroup.update({ createdBy: transferToAdminId }, { where: { createdBy: id } }),
        SessionExercise.update({ createdBy: transferToAdminId }, { where: { createdBy: id } }),
        TermGroup.update({ createdBy: transferToAdminId }, { where: { createdBy: id } }),
        Term.update({ createdBy: transferToAdminId }, { where: { createdBy: id } }),
        await Venue.update(
          { createdBy: transferToAdminId },
          { where: { createdBy: id } }
        ),

        ClassSchedule.update({ createdBy: transferToAdminId }, { where: { createdBy: id } }),
        Booking.update({ bookedBy: transferToAdminId }, { where: { bookedBy: id } }),
        Lead.update({ assignedAgentId: transferToAdminId }, { where: { assignedAgentId: id } }),
        CancelSession.update({ createdBy: transferToAdminId }, { where: { createdBy: id } }),
        ClassScheduleTermMap.update({ createdBy: transferToAdminId }, { where: { createdBy: id } })
      ]);

      if (DEBUG) console.log("✅ Related data reassigned successfully");
    } else {
      // 🔹 Delete all related data
      if (DEBUG) console.log("🔄 No transfer admin, deleting all related data...");

      await Promise.all([
        PaymentGroup.destroy({ where: { createdBy: id }, force: true }),
        PaymentGroupHasPlan.destroy({ where: { createdBy: id }, force: true }),
        PaymentPlan.destroy({ where: { createdBy: id }, force: true }),
        SessionPlanGroup.destroy({ where: { createdBy: id }, force: true }),
        SessionExercise.destroy({ where: { createdBy: id }, force: true }),
        TermGroup.destroy({ where: { createdBy: id }, force: true }),
        Term.destroy({ where: { createdBy: id }, force: true }),
        Venue.destroy({ where: { createdBy: id }, force: true }),
        ClassSchedule.destroy({ where: { createdBy: id }, force: true }),
        Booking.destroy({ where: { bookedBy: id }, force: true }),
        Lead.destroy({ where: { assignedAgentId: id }, force: true }),
        CancelSession.destroy({ where: { createdBy: id }, force: true }),
        ClassScheduleTermMap.destroy({ where: { createdBy: id }, force: true }),
      ]);

      if (DEBUG) console.log("✅ All related data deleted successfully");
    }

    // 🔹 Delete the admin permanently
    if (DEBUG) console.log("🚮 Deleting admin permanently...");
    await Admin.destroy({ where: { id }, force: true });
    if (DEBUG) console.log("✅ Admin deleted permanently");

    return {
      status: true,
      message: transferToAdminId
        ? `Admin deleted and all related data reassigned to admin ${transferToAdminId}`
        : "Admin and all related data deleted permanently",
    };
  } catch (error) {
    console.error("❌ deleteAdmin Error:", error);
    return {
      status: false,
      message: error?.parent?.sqlMessage || error?.message || "Failed to delete admin",
    };
  }
};

// Get all admins
exports.getAllAdminsForReassignData = async () => {
  try {
    const admins = await Admin.findAll({
      attributes: { exclude: ["password", "resetOtp", "resetOtpExpiry"] },
      include: [
        {
          model: AdminRole,
          as: "role",
          attributes: ["id", "role"],
          where: { role: "Admin" }, // ✅ Only include users with role 'Admin'
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    return {
      status: true,
      message: `Fetched ${admins.length} admin(s) successfully.`,
      data: admins,
    };
  } catch (error) {
    console.error("❌ Sequelize Error in getAllAdmins:", error);

    return {
      status: false,
      message:
        error?.parent?.sqlMessage ||
        error?.message ||
        "Failed to fetch admins.",
    };
  }
};

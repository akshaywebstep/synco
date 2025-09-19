const {
  Admin,
  AdminRole,
  Country,
  State,
  City,
  AdminRolePermission,
} = require("../../models");
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
exports.deleteAdmin = async (id, currentAdminId) => {
  try {
    // Prevent deleting own account
    if (parseInt(id) === parseInt(currentAdminId)) {
      return {
        status: false,
        message: "You cannot delete your own account while logged in.",
      };
    }

    const result = await Admin.destroy({
      where: { id },
    });

    if (result === 0) {
      return {
        status: false,
        message: "No admin deleted. The provided ID may be incorrect.",
      };
    }

    return {
      status: true,
      message: "Admin account deleted successfully.",
    };
  } catch (error) {
    console.error("❌ Sequelize Error in deleteAdmin:", error);

    return {
      status: false,
      message:
        error?.parent?.sqlMessage ||
        error?.message ||
        "Failed to delete admin.",
    };
  }
};

const { Member, MemberRole, Country, State, City } = require("../../models");
const { Op } = require("sequelize");

// Create member
exports.createMember = async (data) => {
  try {
    const member = await Member.create(data);

    return {
      status: true,
      message: "Member created successfully.",
      data: { id: member.id },
    };
  } catch (error) {
    console.error("❌ Sequelize Error in createMember:", error);

    return {
      status: false,
      message:
        error?.parent?.sqlMessage ||
        error?.message ||
        "Failed to create member.",
    };
  }
};

// Find member by email
exports.findMemberByEmail = async (email) => {
  try {
    const member = await Member.findOne({ where: { email } });

    if (!member) {
      return {
        status: false,
        message: "Member not found with this email.",
      };
    }

    return {
      status: true,
      message: "Member found.",
      data: member,
    };
  } catch (error) {
    console.error("❌ Sequelize Error in findMemberByEmail:", error);

    return {
      status: false,
      message:
        error?.parent?.sqlMessage ||
        error?.message ||
        "Error occurred while finding member.",
    };
  }
};

// Get member by ID
exports.getMemberById = async (id) => {
  try {
    const member = await Member.findOne({
      where: { id },
      attributes: { exclude: ["password", "resetOtp", "resetOtpExpiry"] },
      include: [
        {
          model: MemberRole,
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

    if (!member) {
      return {
        status: false,
        message: "Member not found by ID.",
      };
    }

    return {
      status: true,
      message: "Member found.",
      data: member,
    };
  } catch (error) {
    console.error("❌ Sequelize Error in getMemberById:", error);

    return {
      status: false,
      message:
        error?.parent?.sqlMessage ||
        error?.message ||
        "Error occurred while fetching member.",
    };
  }
};

// Update member fields by ID
exports.updateMember = async (memberId, updateData) => {
  try {
    const result = await Member.update(updateData, {
      where: { id: memberId },
    });

    if (result[0] === 0) {
      return {
        status: false,
        message: "No member updated. ID may be incorrect.",
      };
    }

    return {
      status: true,
      message: "Member updated successfully.",
    };
  } catch (error) {
    console.error("❌ Sequelize Error in updateMember:", error);

    return {
      status: false,
      message:
        error?.parent?.sqlMessage ||
        error?.message ||
        "Failed to update member.",
    };
  }
};

// Get all members
exports.getAllMembers = async () => {
  try {
    const members = await Member.findAll({
      attributes: { exclude: ["password", "resetOtp", "resetOtpExpiry"] },
      include: [
        {
          model: MemberRole,
          as: "role",
          attributes: ["id", "role"],
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    return {
      status: true,
      message: `Fetched ${members.length} member(s) successfully.`,
      data: members,
    };
  } catch (error) {
    console.error("❌ Sequelize Error in getAllMembers:", error);

    return {
      status: false,
      message:
        error?.parent?.sqlMessage ||
        error?.message ||
        "Failed to fetch members.",
    };
  }
};

// Update password by member ID
exports.updatePasswordById = async (id, newPassword) => {
  try {
    const result = await Member.update(
      { password: newPassword },
      { where: { id } }
    );

    if (result[0] === 0) {
      return {
        status: false,
        message: "No member updated. ID may be incorrect.",
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

// Save OTP to member
exports.saveOtpToMember = async (memberId, otp, expiry) => {
  try {
    const result = await Member.update(
      {
        resetOtp: otp,
        resetOtpExpiry: expiry,
      },
      {
        where: { id: memberId },
      }
    );

    if (result[0] === 0) {
      return {
        status: false,
        message: "Failed to save OTP. Member not found.",
      };
    }

    return {
      status: true,
      message: "OTP saved successfully.",
    };
  } catch (error) {
    console.error("❌ Sequelize Error in saveOtpToMember:", error);

    return {
      status: false,
      message:
        error?.parent?.sqlMessage || error?.message || "Error saving OTP.",
    };
  }
};

// Find member by email and valid OTP
exports.findMemberByEmailAndValidOtp = async (email, otp) => {
  try {
    const member = await Member.findOne({
      where: {
        email,
        resetOtp: otp,
        resetOtpExpiry: {
          [Op.gt]: new Date(),
        },
      },
    });

    if (!member) {
      return {
        status: false,
        message: "Invalid or expired OTP.",
      };
    }

    return {
      status: true,
      message: "Valid OTP found.",
      data: member,
    };
  } catch (error) {
    console.error("❌ Sequelize Error in findMemberByEmailAndValidOtp:", error);

    return {
      status: false,
      message:
        error?.parent?.sqlMessage || error?.message || "Error validating OTP.",
    };
  }
};

// Update password and clear OTP fields
exports.updatePasswordAndClearOtp = async (memberId, hashedPassword) => {
  try {
    const result = await Member.update(
      {
        password: hashedPassword,
        resetOtp: null,
        resetOtpExpiry: null,
      },
      {
        where: { id: memberId },
      }
    );

    if (result[0] === 0) {
      return {
        status: false,
        message: "Failed to update password. Member not found.",
      };
    }

    return {
      status: true,
      message: "Password updated and OTP cleared.",
    };
  } catch (error) {
    console.error("❌ Sequelize Error in updatePasswordAndClearOtp:", error);

    return {
      status: false,
      message:
        error?.parent?.sqlMessage ||
        error?.message ||
        "Error updating password and clearing OTP.",
    };
  }
};

// Delete member by ID
exports.deleteMember = async (id) => {
  try {
    const result = await Member.destroy({
      where: { id },
    });

    if (result === 0) {
      return {
        status: false,
        message: "No member deleted. ID may be incorrect.",
      };
    }

    return {
      status: true,
      message: "Member deleted successfully.",
    };
  } catch (error) {
    console.error("❌ Sequelize Error in deleteMember:", error);

    return {
      status: false,
      message:
        error?.parent?.sqlMessage ||
        error?.message ||
        "Failed to delete member.",
    };
  }
};

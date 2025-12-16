const {
  Admin,
  AdminRole,
  CoachVenueAllocation,
} = require("../../../models");
const DEBUG = process.env.DEBUG === "true";

const { Op } = require("sequelize");

// Get all admins
exports.getAllCoaches = async (superAdminId, includeSuperAdmin = false) => {
  if (!superAdminId || isNaN(Number(superAdminId))) {
    return {
      status: false,
      message: "No valid coach found for this request.",
      data: [],
    };
  }

  try {
    const whereCondition = includeSuperAdmin
      ? {
          [Op.or]: [
            { superAdminId: Number(superAdminId) },
            { id: Number(superAdminId) },
          ],
        }
      : { superAdminId: Number(superAdminId) };

    const admins = await Admin.findAll({
      where: whereCondition,
      attributes: { exclude: ["password", "resetOtp", "resetOtpExpiry"] },
      include: [
        {
          model: AdminRole,
          as: "role",
          attributes: ["id", "role"],
          where: { role: "coach" },  // 🔥 Filter only COACH role
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    return {
      status: true,
      message: `Fetched ${admins.length} coach(s) successfully.`,
      data: admins,
    };
  } catch (error) {
    console.error("❌ Sequelize Error in getAllCoaches:", error);

    return {
      status: false,
      message:
        error?.parent?.sqlMessage ||
        error?.message ||
        "Failed to fetch choaches.",
    };
  }
};

exports.getCoachById = async (coachId, superAdminId) => {
  try {
    if (!coachId || isNaN(Number(coachId))) {
      return {
        status: false,
        message: "Invalid coach ID.",
        data: null,
      };
    }

    if (!superAdminId || isNaN(Number(superAdminId))) {
      return {
        status: false,
        message: "Invalid super admin ID.",
        data: null,
      };
    }

    const coach = await Admin.findOne({
      where: {
        id: Number(coachId),
        superAdminId: Number(superAdminId),
      },
      attributes: {
        exclude: ["password", "resetOtp", "resetOtpExpiry"],
      },
      include: [
        {
          model: AdminRole,
          as: "role",
          attributes: ["id", "role"],
          where: { role: "coach" },
        },
        {
          model: CoachVenueAllocation,
          as: "coachAllocations",
          attributes: [
            "id",
            "venueId",
            "rate",
            "createdBy",
            "createdAt",
            "updatedAt",
          ],
        },
      ],
    });

    if (!coach) {
      return {
        status: false,
        message:
          "Coach not found or does not belong to this Super Admin.",
        data: null,
      };
    }

    /* ==========================
       ✅ PARSE QUALIFICATIONS
    ========================== */
    let parsedQualifications = null;

    if (coach.qualifications) {
      try {
        parsedQualifications =
          typeof coach.qualifications === "string"
            ? JSON.parse(coach.qualifications)
            : coach.qualifications;
      } catch (err) {
        console.warn(
          "⚠️ Failed to parse coach qualifications:",
          err
        );
      }
    }

    // Sequelize → plain object
    const coachData = coach.toJSON();
    coachData.qualifications = parsedQualifications;

    return {
      status: true,
      message: "Coach fetched successfully.",
      data: coachData, // ✅ FIXED
    };
  } catch (error) {
    console.error("❌ Sequelize Error in getCoachById:", error);

    return {
      status: false,
      message:
        error?.parent?.sqlMessage ||
        error?.message ||
        "Failed to fetch coach.",
      data: null,
    };
  }
};

exports.createAllocateVenue = async (data) => {
  try {
    const coach = await CoachVenueAllocation.create(data);

    return {
      status: true,
      message: "Venue Allocated successfully.",
      data: coach,
    };
  } catch (error) {
    console.error("❌ Sequelize Error in createAllocateVenue:", error);

    return {
      status: false,
      message:
        error?.parent?.sqlMessage ||
        error?.message ||
        "Failed to allocate venue.",
    };
  }
};

exports.updateAllocateVenue = async (id, data) => {
  try {
    const existing = await CoachVenueAllocation.findByPk(id);

    if (!existing) {
      return {
        status: false,
        message: "Allocation record not found.",
      };
    }

    await existing.update(data);

    return {
      status: true,
      message: "Venue Allocation updated successfully.",
      data: existing,
    };
  } catch (error) {
    console.error("❌ Sequelize Error in updateAllocateVenue:", error);

    return {
      status: false,
      message:
        error?.parent?.sqlMessage ||
        error?.message ||
        "Failed to update venue allocation.",
    };
  }
};

exports.deleteAllocateVenue = async (id, adminId) => {
  try {
    const allocation = await CoachVenueAllocation.findByPk(id);

    if (!allocation) {
      return {
        status: false,
        message: "Allocation record not found.",
      };
    }

    // Step 1: let Sequelize soft delete (sets deletedAt)
    await allocation.destroy();  // <--- This sets deletedAt

    // Step 2: update deletedBy (need paranoid:false)
    allocation.deletedBy = adminId;
    await allocation.save({ paranoid: false });

    return {
      status: true,
      message: "Venue allocation deleted successfully.",
      data: allocation,
    };
  } catch (error) {
    console.error("❌ Sequelize Error in deleteAllocateVenue:", error);

    return {
      status: false,
      message: error?.message || "Failed to delete venue allocation.",
    };
  }
};

/**
 * Get qualification file URL for a coach
 */
exports.getCoachQualificationFile = async (
  coachId,
  superAdminId,
  qualificationType
) => {
  if (!coachId || isNaN(Number(coachId))) {
    return {
      status: false,
      message: "Invalid coach ID.",
    };
  }

  if (!superAdminId || isNaN(Number(superAdminId))) {
    return {
      status: false,
      message: "Invalid super admin ID.",
    };
  }

  if (!qualificationType) {
    return {
      status: false,
      message: "Qualification type is required.",
    };
  }

  const coach = await Admin.findOne({
    where: {
      id: Number(coachId),
      superAdminId: Number(superAdminId),
    },
    attributes: ["id", "qualifications"],
  });

  if (!coach) {
    return {
      status: false,
      message: "Coach not found.",
    };
  }

  let qualifications = null;

  try {
    qualifications =
      typeof coach.qualifications === "string"
        ? JSON.parse(coach.qualifications)
        : coach.qualifications;
  } catch (err) {
    return {
      status: false,
      message: "Invalid qualification data.",
    };
  }

  const fileUrl = qualifications?.[qualificationType];

  if (!fileUrl) {
    return {
      status: false,
      message: "Qualification file not found.",
    };
  }

  return {
    status: true,
    message: "Qualification file fetched successfully.",
    data: {
      fileUrl,
    },
  };
};
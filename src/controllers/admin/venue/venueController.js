const { validateFormData } = require("../../../utils/validateFormData");
const { logActivity } = require("../../../utils/admin/activityLogger");
const venueModel = require("../../../services/admin/venue/venue");
const {
  createNotification,
  createCustomNotificationForAdmins,
} = require("../../../utils/admin/notificationHelper");
const { Booking } = require("../../../models");
const { Op } = require("sequelize");

const { getMainSuperAdminOfAdmin } = require("../../../utils/auth");
const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "venue";

// ✅ Create Venue
exports.createVenue = async (req, res) => {
  const formData = req.body;

  if (DEBUG) console.log("📥 Creating Venue - Data:", formData);

  const validation = validateFormData(formData, {
    requiredFields: ["area", "name", "address", "facility", "termGroupId"],
    enumValidations: {
      facility: ["Indoor", "Outdoor"],
    },
  });

  if (!validation.isValid) {
    await logActivity(req, PANEL, MODULE, "create", validation.error, false);
    return res.status(400).json({
      status: false,
      message: validation.message,
      error: validation.error,
    });
  }

  try {
    // ✅ Inject createdBy from admin
    formData.createdBy = req.admin?.id;

    const result = await venueModel.createVenue(formData);

    await logActivity(req, PANEL, MODULE, "create", result, result.status);

    // ✅ Create Notification
    await createNotification(
      req,
      "New Venue Created",
      `Venue "${formData.name}" has been created in area "${formData.area}".`,
      "System"
    );

    if (!result.status) {
      return res.status(500).json({ status: false, message: result.message });
    }

    return res.status(201).json({
      status: true,
      message: "Venue created successfully.",
      data: result.data,
    });
  } catch (error) {
    console.error("❌ Create Venue Error:", error);
    return res.status(500).json({
      status: false,
      message: "Server error while creating venue.",
    });
  }
};

// ✅ Get All Venues
exports.getAllVenues = async (req, res) => {
  const createdBy = req.admin?.id;

  const mainSuperAdminResult = await getMainSuperAdminOfAdmin(req.admin.id);
  const superAdminId = mainSuperAdminResult?.superAdmin.id ?? null;

  try {
    const result = await venueModel.getAllVenues(superAdminId);

    await logActivity(req, PANEL, MODULE, "list", result, result.status);

    if (!result.status) {
      return res.status(500).json({
        status: false,
        message: result.message || "Failed to fetch venues.",
      });
    }

    return res.status(200).json({
      status: true,
      message: "Venues fetched successfully.",
      data: result.data,
    });
  } catch (error) {
    console.error("❌ Get All Venues Controller Error:", error.message);
    return res.status(500).json({
      status: false,
      message: "Server error while fetching venues.",
    });
  }
};

// ✅ Get by ID
// ✅ Get Venue by ID
exports.getVenueById = async (req, res) => {
  const { id } = req.params;
  const createdBy = req.admin?.id; // ✅ Ensure only venues created by this admin are accessed

  console.log("📥 Incoming request for venue ID:", id);

  const mainSuperAdminResult = await getMainSuperAdminOfAdmin(req.admin.id);
  const superAdminId = mainSuperAdminResult?.superAdmin.id ?? null;

  try {
    const result = await venueModel.getVenueById(id, superAdminId); // 👈 Pass createdBy if required

    await logActivity(req, PANEL, MODULE, "getById", result, result.status); // ✅ Consistent logging

    if (!result.status) {
      console.warn("⚠️ Venue not found in model.");
      return res.status(404).json({
        status: false,
        message: result.message || "Venue not found.",
      });
    }

    console.log("✅ Venue fetched successfully:", result.data?.id);

    return res.status(200).json({
      status: true,
      message: result.message || "Venue fetched successfully.",
      data: result.data,
    });
  } catch (error) {
    console.error("❌ Get Venue By ID Controller Error:", error.message);
    return res.status(500).json({
      status: false,
      message: "Server error while fetching venue.",
    });
  }
};

// ✅ Update Venue
// exports.updateVenue = async (req, res) => {
//   const { id } = req.params;
//   const formData = req.body;

//   if (DEBUG) console.log("🛠️ Updating Venue ID:", id, formData);

//   const validation = validateFormData(formData, {
//     // requiredFields: ["area", "name", "address", "facility"],
//     enumValidations: {
//       facility: ["Indoor", "Outdoor"],
//     },
//   });

//   if (!validation.isValid) {
//     await logActivity(req, PANEL, MODULE, "update", validation.error, false);
//     return res.status(400).json({
//       status: false,
//       message: validation.message,
//       error: validation.error,
//     });
//   }

//   const result = await venueModel.updateVenue(id, formData);

//   await logActivity(req, PANEL, MODULE, "update", result, result.status);

//   if (!result.status) {
//     return res.status(500).json({ status: false, message: result.message });
//   }
//   // ✅ Create Notification
//   await createNotification(
//     req,
//     "Venue Updated",
//     `Venue "${formData.name}" has been updated.`,
//     "System"
//   );

//   return res.status(200).json({
//     status: true,
//     message: result.message,
//     data: result.data,
//   });
// };

// ✅ Update Venue
exports.updateVenue = async (req, res) => {
  const { id } = req.params;
  const formData = req.body;

  if (DEBUG) console.log("🛠️ Updating Venue ID:", id, formData);

  // ✅ Validate form data
  const validation = validateFormData(formData, {
    // requiredFields: ["area", "name", "address", "facility"],
    enumValidations: {
      facility: ["Indoor", "Outdoor"],
    },
  });

  if (!validation.isValid) {
    await logActivity(req, PANEL, MODULE, "update", validation.error, false);
    return res.status(400).json({
      status: false,
      message: validation.message,
      error: validation.error,
    });
  }

  try {
    // ✅ Update venue using model
    const result = await venueModel.updateVenue(id, formData);

    await logActivity(req, PANEL, MODULE, "update", result, result.status);

    if (!result.status) {
      // Always return JSON object
      return res.status(500).json({
        status: false,
        message: result.message || "Update failed",
      });
    }

    // ✅ Create Notification
    await createNotification(
      req,
      "Venue Updated",
      `Venue "${formData.name}" has been updated.`,
      "System"
    );
    // 🔹 Find all bookings using this venue
    const affectedBookings = await Booking.findAll({
      where: { venueId: id, status: { [Op.notIn]: ["cancelled", "removed"] } },
      attributes: ["id", "parentAdminId"]
    });

    for (const booking of affectedBookings) {
      const parentAdminId = booking.parentAdminId;
      if (!parentAdminId) continue;

      try {
        await createCustomNotificationForAdmins({
          title: "Venue Updated",
          description: `The venue "${formData.name}" for your booking has been updated. Please check the new details.`,
          category: "Updates",
          createdByAdminId: req.admin?.id,
          recipientAdminIds: [parentAdminId],
        });

        if (DEBUG) {
          console.log(
            `🔔 Custom notification sent for bookingId=${booking.id} to parentAdminId=${parentAdminId}`
          );
        }
      } catch (err) {
        console.error(
          `❌ Failed to send custom notification for bookingId=${booking.id}:`,
          err.message
        );
      }
    }
    // ✅ Return successful response
    return res.status(200).json({
      status: true,
      message: result.message,
      data: result.data,
    });
  } catch (error) {
    console.error("❌ updateVenue Controller Error:", error);

    // ✅ Always return JSON on unexpected errors
    return res.status(500).json({
      status: false,
      message: "Something broke! " + (error.message || ""),
    });
  }
};

// ✅ Delete Venue
// exports.deleteVenue = async (req, res) => {
//   try {
//     const { id } = req.params;

//     const result = await venueModel.deleteVenue(id);

//     // Log activity
//     await logActivity(req, PANEL, MODULE, "delete", result, result.status);

//     if (!result.status) {
//       // If venue not found, return 404
//       return res.status(404).json({
//         status: false,
//         message: result.message || "Venue not found.",
//       });
//     }

//     // ✅ Create Notification
//     await createNotification(
//       req,
//       "Venue Deleted",
//       `Venue "${result.name || "Unknown"}" has been deleted.`,
//       "System"
//     );

//     return res.status(200).json({
//       status: true,
//       message: "Venue deleted successfully.",
//     });
//   } catch (error) {
//     console.error("❌ deleteVenue Error:", error);
//     return res.status(500).json({
//       status: false,
//       message: "Server error while deleting venue.",
//     });
//   }
// };

// ✅ Delete Venue (soft delete)
exports.deleteVenue = async (req, res) => {
  try {
    const { id } = req.params;
    const adminId = req.admin?.id; // admin performing the delete

    if (!id) {
      return res.status(400).json({ status: false, message: "Venue ID is required." });
    }

    const result = await venueModel.deleteVenue(id, adminId);

    // Log activity
    await logActivity(req, PANEL, MODULE, "delete", result, result.status);

    if (!result.status) {
      return res.status(404).json({
        status: false,
        message: result.message || "Venue not found.",
      });
    }

    // ✅ Create notification
    await createNotification(
      req,
      "Venue Deleted",
      `Venue "${result.name || "Unknown"}" has been deleted by ${req.admin?.firstName || "Admin"}.`,
      "System"
    );

    return res.status(200).json({
      status: true,
      message: "Venue deleted successfully.",
    });
  } catch (error) {
    console.error("❌ deleteVenue Controller Error:", error);
    return res.status(500).json({
      status: false,
      message: "Server error while deleting venue.",
    });
  }
};
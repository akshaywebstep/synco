const { validateFormData } = require("../../../utils/validateFormData");
const ClassScheduleService = require("../../../services/admin/classSchedule/classSchedule");
const { logActivity } = require("../../../utils/admin/activityLogger");
const { Venue } = require("../../../models");
const {
  createNotification,
} = require("../../../utils/admin/notificationHelper");
const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "class-schedule";

function timeToMinutes(time) {
  const [timePart, period] = time.split(" "); // e.g., "10:30 AM"
  let [hours, minutes] = timePart.split(":").map(Number);

  if (period.toUpperCase() === "PM" && hours !== 12) hours += 12;
  if (period.toUpperCase() === "AM" && hours === 12) hours = 0;

  return hours * 60 + minutes;
}
exports.createClassSchedule = async (req, res) => {
  const {
    className,
    capacity,
    day,
    startTime,
    endTime,
    allowFreeTrial,
    facility,
    venueId,
  } = req.body;

  const createdBy = req.admin?.id; // ✅ Securely taken from logged-in admin

  if (DEBUG) {
    console.log("📥 Creating new class schedule:", req.body);
  }

  // ✅ Validation (do NOT include createdBy)
  const validation = validateFormData(req.body, {
    requiredFields: ["className", "day", "startTime", "endTime", "venueId"],
  });

  if (!validation.isValid) {
    if (DEBUG) console.log("❌ Validation failed:", validation.error);
    await logActivity(req, PANEL, MODULE, "create", validation.error, false);
    return res.status(400).json({ status: false, ...validation });
  }

  // ✅ Ensure startTime is before endTime
  if (timeToMinutes(startTime) > timeToMinutes(endTime)) {
    if (DEBUG) console.log("❌ Start time must be before end time");
    await logActivity(
      req,
      PANEL,
      MODULE,
      "create",
      { message: "Start time must be before end time" },
      false
    );
    return res.status(400).json({
      status: false,
      message: "Start time must be before end time.",
    });
  }

  // ✅ Check if venue exists
  const venue = await Venue.findByPk(venueId);
  if (!venue) {
    if (DEBUG) console.log("❌ Venue not found:", venueId);
    await logActivity(
      req,
      PANEL,
      MODULE,
      "create",
      { message: "Venue not found" },
      false
    );
    return res.status(404).json({
      status: false,
      message: "Invalid venue selected. Venue does not exist.",
    });
  }

  try {
    const result = await ClassScheduleService.createClass({
      className,
      capacity,
      day,
      startTime,
      endTime,
      allowFreeTrial,
      facility,
      venueId,
      createdBy, // ✅ Added here
    });

    if (!result.status) {
      if (DEBUG) console.log("⚠️ Creation failed:", result.message);
      await logActivity(req, PANEL, MODULE, "create", result, false);
      return res.status(500).json({ status: false, message: result.message });
    }

    if (DEBUG) console.log("✅ Class schedule created:", result.data);
    await logActivity(req, PANEL, MODULE, "create", result, true);

    await createNotification(
      req,
      "New Class Schedule Created",
      `Class "${className}" has been scheduled on ${day} from ${startTime} to ${endTime}.`,
      "System"
    );

    return res.status(201).json({
      status: true,
      message: "Class schedule created successfully.",
      data: result.data,
    });
  } catch (error) {
    console.error("❌ Server error during creation:", error);
    await logActivity(
      req,
      PANEL,
      MODULE,
      "create",
      { oneLineMessage: error.message },
      false
    );
    return res.status(500).json({ status: false, message: "Server error." });
  }
};

// ✅ GET All Class Schedules
exports.getAllClassSchedules = async (req, res) => {
  if (DEBUG) console.log("📥 Fetching all class schedules...");

  try {
    const adminId = req.admin?.id;
    const result = await ClassScheduleService.getAllClasses(adminId); // ✅ pass admin ID

    if (!result.status) {
      if (DEBUG) console.log("⚠️ Fetch failed:", result.message);
      await logActivity(req, PANEL, MODULE, "list", result, false);
      return res.status(500).json({ status: false, message: result.message });
    }

    if (DEBUG) console.table(result.data);
    await logActivity(
      req,
      PANEL,
      MODULE,
      "list",
      { oneLineMessage: `Fetched ${result.data.length} class schedules.` },
      true
    );

    return res.status(200).json({
      status: true,
      message: "Fetched class schedules successfully.",
      data: result.data,
    });
  } catch (error) {
    console.error("❌ Error fetching all class schedules:", error);
    await logActivity(
      req,
      PANEL,
      MODULE,
      "list",
      { oneLineMessage: error.message },
      false
    );
    return res.status(500).json({ status: false, message: "Server error." });
  }
};

// ✅ GET Class Schedule by ID with Venue
exports.getClassScheduleDetails = async (req, res) => {
  const { id } = req.params;
  if (DEBUG) console.log(`🔍 Fetching class + venue for class ID: ${id}`);

  try {
    // ✅ Call service with only classId (no adminId)
    const result = await ClassScheduleService.getClassByIdWithFullDetails(id);

    if (!result.status) {
      if (DEBUG) console.log("⚠️ Not found:", result.message);
      return res.status(404).json({ status: false, message: result.message });
    }

    if (DEBUG) console.log("✅ Data fetched:", result.data);
    await logActivity(
      req,
      PANEL,
      MODULE,
      "getById",
      { oneLineMessage: `Fetched class schedule with ID: ${id}` },
      true
    );

    return res.status(200).json({
      status: true,
      message: "Class and venue fetched successfully.",
      data: result.data,
    });
  } catch (error) {
    console.error("❌ Error fetching class schedule:", error);
    return res.status(500).json({ status: false, message: "Server error." });
  }
};

// exports.getClassScheduleDetails = async (req, res) => {
//   const { id } = req.params;
//   const adminId = req.admin?.id;
//   if (DEBUG) console.log(`🔍 Fetching class + venue for class ID: ${id}`);

//   try {
//     const result = await ClassScheduleService.getClassByIdWithFullDetails(
//       id,
//       adminId
//     );

//     if (!result.status) {
//       if (DEBUG) console.log("⚠️ Not found:", result.message);
//       return res.status(404).json({ status: false, message: result.message });
//     }

//     if (DEBUG) console.log("✅ Data fetched:", result.data);
//     await logActivity(
//       req,
//       PANEL,
//       MODULE,
//       "getById",
//       { oneLineMessage: `Fetched class schedule with ID: ${id}` },
//       true
//     );

//     return res.status(200).json({
//       status: true,
//       message: "Class and venue fetched successfully.",
//       data: result.data,
//     });
//   } catch (error) {
//     console.error("❌ Error fetching class schedule:", error);
//     return res.status(500).json({ status: false, message: "Server error." });
//   }
// };

exports.updateClassSchedule = async (req, res) => {
  const { id } = req.params;
  const {
    className,
    capacity,
    day,
    startTime,
    endTime,
    allowFreeTrial,
    facility,
    venueId,
  } = req.body;

  const adminId = req.admin?.id;

  if (DEBUG) console.log(`✏️ Updating class schedule ID: ${id}`, req.body);

  const validation = validateFormData(req.body, {
    requiredFields: ["className", "day", "startTime", "endTime", "venueId"],
  });

  if (!validation.isValid) {
    if (DEBUG) console.log("❌ Validation failed:", validation.error);
    await logActivity(req, PANEL, MODULE, "update", validation.error, false);
    return res.status(400).json({ status: false, ...validation });
  }

  const venue = await Venue.findByPk(venueId);
  if (!venue) {
    if (DEBUG) console.log("❌ Invalid venue ID:", venueId);
    return res.status(404).json({
      status: false,
      message: "Venue not found. Please select a valid venue.",
    });
  }

  try {
    const result = await ClassScheduleService.updateClass(id, {
      className,
      capacity,
      day,
      startTime,
      endTime,
      allowFreeTrial,
      facility,
      venueId,
      createdBy: adminId, // ✅ FIXED HERE
    });

    if (!result.status) {
      if (DEBUG) console.log("⚠️ Update failed:", result.message);
      return res.status(404).json({ status: false, message: result.message });
    }

    if (DEBUG) console.log("✅ Class schedule updated:", result.data);
    await logActivity(
      req,
      PANEL,
      MODULE,
      "update",
      { oneLineMessage: `Updated class schedule with ID: ${id}` },
      true
    );

    await createNotification(
      req,
      "Class Schedule Updated",
      `Class "${className}" was updated for ${day}, ${startTime} - ${endTime}.`,
      "System"
    );

    return res.status(200).json({
      status: true,
      message: "Class schedule updated successfully.",
      data: result.data,
    });
  } catch (error) {
    console.error("❌ Error updating class schedule:", error);
    await logActivity(
      req,
      PANEL,
      MODULE,
      "update",
      { oneLineMessage: error.message },
      false
    );
    return res.status(500).json({ status: false, message: "Server error." });
  }
};

// exports.updateClassSchedule = async (req, res) => {
//   const { id } = req.params;
//   const {
//     className,
//     capacity,
//     day,
//     startTime,
//     endTime,
//     allowFreeTrial,
//     facility,
//     venueId,
//   } = req.body;

//   const adminId = req.admin?.id; // ✅ Get logged-in admin ID

//   if (DEBUG) {
//     console.log(`✏️ Updating class schedule ID: ${id}`, req.body);
//   }

//   // ✅ Validate required fields
//   const validation = validateFormData(req.body, {
//     requiredFields: ["className", "day", "startTime", "endTime", "venueId"],
//   });

//   if (!validation.isValid) {
//     if (DEBUG) console.log("❌ Validation failed:", validation.error);
//     await logActivity(req, PANEL, MODULE, "update", validation.error, false);
//     return res.status(400).json({ status: false, ...validation });
//   }

//   // ✅ Validate venue
//   const venue = await Venue.findByPk(venueId);
//   if (!venue) {
//     if (DEBUG) console.log("❌ Invalid venue ID:", venueId);
//     return res.status(404).json({
//       status: false,
//       message: "Venue not found. Please select a valid venue.",
//     });
//   }

//   try {
//     // ✅ Get class schedule with createdBy
//     const classSchedule = await ClassScheduleService.findByPk(id);
//     if (!classSchedule) {
//       return res.status(404).json({
//         status: false,
//         message: "Class schedule not found.",
//       });
//     }

//     // ✅ Authorization check
//     if (classSchedule.createdBy !== adminId) {
//       if (DEBUG)
//         console.log("🚫 Unauthorized update attempt by admin:", adminId);
//       return res.status(403).json({
//         status: false,
//         message: "You are not authorized to update this class schedule.",
//       });
//     }

//     // ✅ Proceed with update
//     const result = await ClassScheduleService.updateClass(id, {
//       className,
//       capacity,
//       day,
//       startTime,
//       endTime,
//       allowFreeTrial,
//       facility,
//       venueId,
//     });

//     if (!result.status) {
//       if (DEBUG) console.log("⚠️ Update failed:", result.message);
//       return res.status(404).json({ status: false, message: result.message });
//     }

//     if (DEBUG) console.log("✅ Class schedule updated:", result.data);
//     await logActivity(
//       req,
//       PANEL,
//       MODULE,
//       "update",
//       { oneLineMessage: `Updated class schedule with ID: ${id}` },
//       true
//     );

//     await createNotification(
//       req,
//       "Class Schedule Updated",
//       `Class "${className}" was updated for ${day}, ${startTime} - ${endTime}.`,
//       "Admins"
//     );

//     return res.status(200).json({
//       status: true,
//       message: "Class schedule updated successfully.",
//       data: result.data,
//     });
//   } catch (error) {
//     console.error("❌ Error updating class schedule:", error);
//     await logActivity(
//       req,
//       PANEL,
//       MODULE,
//       "update",
//       { oneLineMessage: error.message },
//       false
//     );
//     return res.status(500).json({ status: false, message: "Server error." });
//   }
// };

// ✅ DELETE Class Schedule
exports.deleteClassSchedule = async (req, res) => {
  const { id } = req.params;
  if (DEBUG) console.log(`🗑️ Deleting class schedule with ID: ${id}`);

  try {
    const result = await ClassScheduleService.deleteClass(id);

    if (!result.status) {
      if (DEBUG) console.log("⚠️ Delete failed:", result.message);
      return res.status(404).json({ status: false, message: result.message });
    }

    if (DEBUG) console.log("✅ Class schedule deleted");
    await logActivity(
      req,
      PANEL,
      MODULE,
      "delete",
      { oneLineMessage: `Deleted class schedule with ID: ${id}` },
      true
    );
    // ✅ Create notification
    await createNotification(
      req,
      "Class Schedule Deleted",
      `Class schedule with ID ${id} has been deleted.`,
      "Admins"
    );
    return res.status(200).json({
      status: true,
      message: "Class schedule deleted successfully.",
    });
  } catch (error) {
    console.error("❌ Error deleting class schedule:", error);
    await logActivity(
      req,
      PANEL,
      MODULE,
      "delete",
      { oneLineMessage: error.message },
      false
    );
    return res.status(500).json({ status: false, message: "Server error." });
  }
};
// ✅ DELETE Class Schedule
exports.deleteClassSchedule = async (req, res) => {
  const { id } = req.params;
  const adminId = req.adminId;

  if (DEBUG)
    console.log(
      `🗑️ Deleting class schedule with ID: ${id} by Admin: ${adminId}`
    );

  try {
    const result = await ClassScheduleService.deleteClass(id, adminId); // ✅ Pass adminId

    if (!result.status) {
      if (DEBUG) console.log("⚠️ Delete failed:", result.message);
      return res.status(404).json({ status: false, message: result.message });
    }

    if (DEBUG) console.log("✅ Class schedule deleted");

    await logActivity(
      req,
      PANEL,
      MODULE,
      "delete",
      { oneLineMessage: `Deleted class schedule with ID: ${id}` },
      true
    );

    await createNotification(
      req,
      "Class Schedule Deleted",
      `Class schedule with ID ${id} has been deleted.`,
      "Admins"
    );

    return res.status(200).json({
      status: true,
      message: "Class schedule deleted successfully.",
    });
  } catch (error) {
    console.error("❌ Error deleting class schedule:", error);

    await logActivity(
      req,
      PANEL,
      MODULE,
      "delete",
      { oneLineMessage: error.message },
      false
    );

    return res.status(500).json({ status: false, message: "Server error." });
  }
};

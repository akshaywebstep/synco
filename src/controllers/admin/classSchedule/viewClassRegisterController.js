const AttendanceRegisterService = require("../../../services/admin/classSchedule/viewClassRegister");
const { logActivity } = require("../../../utils/admin/activityLogger");

const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "attendance-register";

exports.getAttendanceRegister = async (req, res) => {
  const { classScheduleId } = req.params;

  if (DEBUG) {
    console.log("📥 Fetching attendance register for classSchedule:", classScheduleId);
  }

  if (!classScheduleId) {
    await logActivity(
      req,
      PANEL,
      MODULE,
      "getRegister",
      { message: "classScheduleId is required." },
      false
    );
    return res.status(400).json({
      status: false,
      message: "classScheduleId is required.",
    });
  }

  try {
    const result = await AttendanceRegisterService.getAttendanceRegister(classScheduleId);

    if (!result.status) {
      await logActivity(req, PANEL, MODULE, "getRegister", result, false);
      return res.status(404).json({ status: false, message: result.message });
    }

    await logActivity(
      req,
      PANEL,
      MODULE,
      "getRegister",
      { oneLineMessage: `Fetched attendance register for classScheduleId: ${classScheduleId}` },
      true
    );

    return res.status(200).json(result);
  } catch (error) {
    console.error("❌ Controller error in getAttendanceRegister:", error);
    await logActivity(
      req,
      PANEL,
      MODULE,
      "getRegister",
      { oneLineMessage: error.message },
      false
    );
    return res.status(500).json({
      status: false,
      message: "Server error.",
    });
  }
};

exports.updateAttendanceStatus = async (req, res) => {
  const { studentId } = req.params;
  const { attendance } = req.body;

  if (DEBUG) console.log(`📥 Updating attendance for student ${studentId}:`, attendance);

  if (!studentId || !["attended", "not attended"].includes(attendance)) {
    await logActivity(
      req,
      PANEL,
      MODULE,
      "updateAttendance",
      { message: "Invalid studentId or attendance value." },
      false
    );
    return res.status(400).json({
      status: false,
      message: "Invalid studentId or attendance value.",
    });
  }

  try {
    const result = await AttendanceRegisterService.updateAttendanceStatus(studentId, attendance);

    if (!result.status) {
      await logActivity(req, PANEL, MODULE, "updateAttendance", result, false);
      return res.status(404).json({ status: false, message: result.message });
    }

    await logActivity(
      req,
      PANEL,
      MODULE,
      "updateAttendance",
      { oneLineMessage: `Updated attendance for student ${studentId}.` },
      true
    );

    return res.status(200).json(result);
  } catch (error) {
    console.error("❌ Controller error in updateAttendanceStatus:", error);
    await logActivity(
      req,
      PANEL,
      MODULE,
      "updateAttendance",
      { oneLineMessage: error.message },
      false
    );
    return res.status(500).json({ status: false, message: "Server error." });
  }
};

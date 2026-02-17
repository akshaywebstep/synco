const { validateFormData } = require("../../../../utils/validateFormData");
const holidayComment = require("../../../../services/admin/holidayCamps/booking/holidayComment");

const { logActivity } = require("../../../../utils/admin/activityLogger");
const {
  Admin,
} = require("../../../../models");
const {
  createNotification,
} = require("../../../../utils/admin/notificationHelper");
const { getMainSuperAdminOfAdmin } = require("../../../../utils/auth");

const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "holiday-comment";

exports.addCommentForHolidayCamp = async (req, res) => {
  const payload = req.body;

  if (DEBUG) console.log("🎯 Add Comment Payload:", payload);

  // ✅ Validate request body
  const { isValid, error } = validateFormData(payload, {
    requiredFields: ["comment"], // comment is required
    optionalFields: ["commentType"],
  });

  if (!isValid) {
    await logActivity(req, PANEL, MODULE, "create", error, false);
    if (DEBUG) console.log("❌ Validation failed:", error);
    return res.status(400).json({ status: false, ...error });
  }

  try {
    // ✅ Use authenticated admin ID
    const commentBy = req.admin?.id || null;

    const result = await holidayComment.addCommentForHolidayCamp({
      commentBy,
      comment: payload.comment,
      commentType: payload.commentType || "paid",
    });

    if (!result.status) {
      await logActivity(req, PANEL, MODULE, "create", result, false);
      if (DEBUG) console.log("❌ Comment creation failed:", result.message);
      return res.status(400).json({ status: false, message: result.message });
    }

    // ✅ Log admin activity
    await logActivity(
      req,
      PANEL,
      MODULE,
      "create",
      { message: `Comment added for book a free trial` },
      true
    );
    if (DEBUG) console.log("📝 Activity logged successfully");

    // ✅ Notify admins
    const createdBy = req.admin?.firstName || "An admin";
    await createNotification(
      req,
      "New Comment",
      `${createdBy} added a comment for book a free trial.`,
      "Admins"
    );
    if (DEBUG) console.log("🔔 Notification created for admins");

    return res.status(201).json({
      status: true,
      message: "✅ Comment added successfully.",
      data: result.data,
    });
  } catch (error) {
    console.error("❌ Error adding comment:", error);

    await logActivity(
      req,
      PANEL,
      MODULE,
      "create",
      { error: error.message },
      false
    );

    return res.status(500).json({ status: false, message: "Server error." });
  }
};

exports.listCommentsForHolidayCamp = async (req, res) => {
  try {
    const commentType = req.query.commentType;

    const result = await holidayComment.listCommentsForHolidayCamp({
      commentType,
    });

    if (!result.status) {
      await logActivity(req, PANEL, MODULE, "list", result, false);
      return res.status(400).json({ status: false, message: result.message });
    }

    await logActivity(
      req,
      PANEL,
      MODULE,
      "list",
      { message: "Comments listed successfully" },
      true
    );

    return res.status(200).json({
      status: true,
      message: "✅ Comments fetched successfully",
      data: result.data,
    });
  } catch (error) {
    console.error("❌ Error listing comments:", error);

    await logActivity(
      req,
      PANEL,
      MODULE,
      "list",
      { error: error.message },
      false
    );

    return res.status(500).json({ status: false, message: "Server error." });
  }
};
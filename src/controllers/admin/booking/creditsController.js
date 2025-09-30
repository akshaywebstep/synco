const { validateFormData } = require("../../../utils/validateFormData");
const { logActivity } = require("../../../utils/admin/activityLogger");
const CreditService = require("../../../services/admin/booking/credits");
const {
  createNotification,
} = require("../../../utils/admin/notificationHelper");

const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "credits";

// ✅ Create Credit
exports.createCredit = async (req, res) => {
  const payload = req.body;

  if (DEBUG) console.log("🎯 Create Credit Payload:", payload);

  // ✅ Validate request body
  const { isValid, error } = validateFormData(payload, {
    requiredFields: ["creditAmount", "reason"], // bookingId optional
  });

  if (!isValid) {
    await logActivity(req, PANEL, MODULE, "create", error, false);
    return res.status(400).json({ status: false, ...error });
  }

  try {
    const result = await CreditService.createCredit({
      bookingId: payload.bookingId || null,
      creditAmount: payload.creditAmount,
      reason: payload.reason,
    });

    if (!result.status) {
      await logActivity(req, PANEL, MODULE, "create", result, false);
      return res.status(400).json({ status: false, message: result.message });
    }

    // ✅ Log admin activity
    await logActivity(
      req,
      PANEL,
      MODULE,
      "create",
      { message: `Credit created for booking #${payload.bookingId || "N/A"}` },
      true
    );

    // ✅ Notify admins
    const createdBy = req?.user?.firstName || "An admin";
    await createNotification(
      req,
      "Credit Issued",
      `${createdBy} issued a credit for booking #${
        payload.bookingId || "N/A"
      }.`,
      "Admins"
    );

    return res.status(201).json({
      status: true,
      message: "Credit created successfully.",
      data: result.data,
    });
  } catch (error) {
    console.error("❌ Error creating credit:", error);
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

// ✅ Get All Credits
exports.getAllCredits = async (req, res) => {
  try {
    const result = await CreditService.getAllCredits();

    if (!result.status) {
      await logActivity(req, PANEL, MODULE, "read", result, false);
      return res.status(400).json({ status: false, message: result.message });
    }

    await logActivity(
      req,
      PANEL,
      MODULE,
      "read",
      { message: "Fetched all credits successfully." },
      true
    );

    return res.status(200).json({
      status: true,
      message: "Credits fetched successfully.",
      data: result.data,
    });
  } catch (error) {
    console.error("❌ Error fetching credits:", error);
    await logActivity(
      req,
      PANEL,
      MODULE,
      "read",
      { error: error.message },
      false
    );
    return res.status(500).json({ status: false, message: "Server error." });
  }
};

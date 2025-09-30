const { validateFormData } = require("../../../utils/validateFormData");
const { logActivity } = require("../../../utils/admin/activityLogger");
const NoMembershipTrialService = require("../../../services/admin/booking/noMembershipTrial");

const PANEL = "admin";
const DEBUG = true;
const MODULE = "no_membership_trial";

exports.createNoMembershipTrial = async (req, res) => {
  const payload = req.body;

  const { isValid, error } = validateFormData(payload, {
    requiredFields: ["bookingId", "noMembershipReason"],
  });

  if (!isValid) {
    await logActivity(req, PANEL, MODULE, "create", error, false);
    return res.status(400).json({ status: false, ...error });
  }

  try {
    // ✅ Force bookingType = "free"
    payload.bookingType = "free_trial";

    if (DEBUG) {
      console.log("📌 createNoMembershipTrial Payload:", payload);
    }

    const result = await NoMembershipTrialService.createNoMembershipTrial(
      payload
    );

    if (!result.status) {
      return res.status(400).json({ status: false, message: result.message });
    }

    await logActivity(req, PANEL, MODULE, "create", result, true);

    return res.status(201).json({
      status: true,
      message: "No membership record created successfully.",
      data: result.data,
    });
  } catch (err) {
    if (DEBUG) {
      console.error("❌ createNoMembershipTrial Error:", err);
    }
    return res.status(500).json({ status: false, message: "Server error." });
  }
};

// ✅ Get all No Membership trials
exports.getNoMembershipTrials = async (req, res) => {
  try {
    const result = await NoMembershipTrialService.getNoMembershipTrials();

    if (!result.status) {
      await logActivity(req, PANEL, MODULE, "read", result, false);
      return res.status(400).json({ status: false, message: result.message });
    }

    await logActivity(
      req,
      PANEL,
      MODULE,
      "read",
      { message: `Fetched ${result.data.length} no membership trials` },
      true
    );

    return res.status(200).json({
      status: true,
      message: "No membership trials fetched successfully.",
      data: result.data,
    });
  } catch (error) {
    console.error("❌ Error fetching no membership trials:", error);
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

exports.sendNoMembershipTrialEmail = async (req, res) => {
  const { bookingId } = req.body;

  if (!bookingId) {
    return res.status(400).json({
      status: false,
      message: "bookingId is required",
    });
  }

  try {
    const result =
      await NoMembershipTrialService.sendNoMembershipEmailToParents({
        bookingId,
      });

    if (!result.status) {
      await logActivity(req, PANEL, MODULE, "send", result, false);
      return res.status(400).json({ status: false, message: result.message });
    }

    await logActivity(
      req,
      PANEL,
      MODULE,
      "send",
      { message: `No Membership Trial email sent for bookingId ${bookingId}` },
      true
    );

    return res.status(200).json({
      status: true,
      message: result.message,
      sentTo: result.sentTo,
    });
  } catch (error) {
    console.error("❌ Controller sendNoMembershipTrialEmail Error:", error);
    await logActivity(
      req,
      PANEL,
      MODULE,
      "send",
      { error: error.message },
      false
    );
    return res.status(500).json({ status: false, message: "Server error" });
  }
};

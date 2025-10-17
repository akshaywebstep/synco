const { validateFormData } = require("../../../utils/validateFormData");
const capacityService = require("../../../services/admin/booking/capacity");
const { logActivity } = require("../../../utils/admin/activityLogger");
const { getMainSuperAdminOfAdmin } = require("../../../utils/auth");

const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "listing-capacity";

exports.getAllBookings = async (req, res) => {
  if (DEBUG) console.log("📥 Fetching all bookings (free + paid)...");

  // ✅ Map query params into filters
  const filters = {
    studentName: req.query.studentName,
    trialDate: req.query.trialDate,
    status: req.query.status,
    venueId: req.query.venueId,
    venueName: req.query.venueName,
    bookedBy: req.query.bookedBy,
    fromDate: req.query.fromDate || req.query.dateTrialFrom || undefined,
    toDate: req.query.toDate || req.query.dateTrialTo || undefined,
  };

  try {
    const mainSuperAdminResult = await getMainSuperAdminOfAdmin(req.admin.id);
    const superAdminId = mainSuperAdminResult?.superAdminId ?? null;

    const result = await capacityService.getAllBookings(superAdminId, filters);

    if (!result.status) {
      await logActivity(req, PANEL, MODULE, "list", result, false);
      return res.status(500).json({ status: false, message: result.message });
    }

    // ✅ Count total venues instead of bookings
    const count = result.data?.venues?.length || 0;

    await logActivity(
      req,
      PANEL,
      MODULE,
      "list",
      { message: `Fetched ${count} venues with stats.` },
      true
    );

    return res.status(200).json(result);
  } catch (error) {
    console.error("❌ Error fetching bookings:", error);
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

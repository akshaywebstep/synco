const LeadService = require("../../../services/admin/lead/leads");
const { logActivity } = require("../../../utils/admin/activityLogger");
const {
  createNotification,
} = require("../../../utils/admin/notificationHelper");
const { validateFormData } = require("../../../utils/validateFormData");

const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "leads";

exports.createLead = async (req, res) => {
  const { firstName, lastName, email, phone, postcode, childAge, status } =
    req.body;

  if (DEBUG) {
    console.log("📥 Creating new lead:", req.body);
  }

  // ✅ Validation
  const validation = validateFormData(req.body, {
    requiredFields: ["firstName", "lastName", "email", "childAge"],
  });

  if (!validation.isValid) {
    if (DEBUG) console.log("❌ Validation failed:", validation.error);
    await logActivity(req, PANEL, MODULE, "create", validation.error, false);
    return res.status(400).json({ status: false, ...validation });
  }

  try {
    const result = await LeadService.createLead({
      firstName,
      lastName,
      email,
      phone,
      postcode,
      childAge,
      status,
      assignedAgentId: req.admin.id, // ✅ add logged-in admin ID
    });

    if (!result.status) {
      if (DEBUG) console.log("⚠️ Lead creation failed:", result.message);
      await logActivity(req, PANEL, MODULE, "create", result, false);
      return res.status(500).json({ status: false, message: result.message });
    }

    if (DEBUG) console.log("✅ Lead created:", result.data);

    await logActivity(req, PANEL, MODULE, "create", result, true);

    await createNotification(
      req,
      "New Lead Created",
      `Lead "${firstName} ${lastName}" has been added by Admin ID ${req.admin.id}.`, // 👀 include admin info if needed
      "System"
    );

    return res.status(201).json({
      status: true,
      message: "Lead created successfully.",
      data: result.data,
    });
  } catch (error) {
    console.error("❌ Server error during lead creation:", error);
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

// ✅ Controller: Get All Leads
exports.getAllLeads = async (req, res) => {
  try {
    if (DEBUG) console.log("📥 Fetching all leads");

    const filters = {
      name: req.query.name || null,
      venueName: req.query.venueName || null, // ✅ filter by venue
      fromDate: req.query.fromDate || null,
      toDate: req.query.toDate || null,
      status: req.query.status || null,
    };

    // Service call
    const result = await LeadService.getAllLeads(filters);

    if (!result.status) {
      if (DEBUG) console.log("⚠️ Failed fetching leads:", result.message);

      await logActivity(req, PANEL, MODULE, "read", result, false);

      return res
        .status(400) // better for "failed" instead of 500 unless it's server error
        .json({ status: false, message: result.message });
    }

    if (DEBUG) console.log(`✅ Retrieved ${result.data?.length || 0} leads`);

    await logActivity(
      req,
      PANEL,
      MODULE,
      "read",
      { count: result.data?.length || 0 },
      true
    );

    // ✅ Send final response
    return res.status(200).json({
      status: true,
      message: "Leads with nearest venues retrieved",
      data: result.data || [],
      allVenues: result.allVenues || [],
      analytics: result.analytics || {},
    });
  } catch (error) {
    console.error("❌ getAllLeads Error:", error);

    await logActivity(
      req,
      PANEL,
      MODULE,
      "read",
      { error: error.message },
      false
    );

    return res
      .status(500)
      .json({ status: false, message: "Server error.", error: error.message });
  }
};

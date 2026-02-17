const { validateFormData } = require("../../../../utils/validateFormData");
const PaymentPlan = require("../../../../services/admin/holidayCamps/payment/holidayPaymentPlan");
const { logActivity } = require("../../../../utils/admin/activityLogger");
const { getMainSuperAdminOfAdmin } = require("../../../../utils/auth");
const {
  createNotification,
} = require("../../../../utils/admin/notificationHelper");

const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "holiday-payment-plan";

// ✅ CREATE Plan
exports.createHolidayPaymentPlan = async (req, res) => {
  const formData = req.body;

  const {
    title,
    price,
    interval,
    duration,
    students,
    joiningFee,
    holidayCampPackage,
    termsAndCondition,
    createdBy,
  } = formData;

  if (DEBUG) {
    console.log("📥 STEP 1: Received request to create a new payment plan");
    console.log("📝 Form Data:", formData);
  }

  const validation = validateFormData(formData, {
    requiredFields: [
      "title",
      "price",
      "interval",
      "duration",
      "students",
    ],
  });

  if (!validation.isValid) {
    if (DEBUG) console.log("❌ STEP 2: Validation failed:", validation.error);
    await logActivity(req, PANEL, MODULE, "create", validation.error, false);
    return res.status(400).json({
      status: false,
      error: validation.error,
      message: validation.message,
    });
  }

  try {
    const result = await PaymentPlan.createHolidayPlan({
      title,
      price,
      interval,
      duration,
      students,
      joiningFee,
      holidayCampPackage,
      termsAndCondition,
      createdBy: req.admin.id,
    });

    if (!result.status) {
      if (DEBUG) console.log("⚠️ STEP 3: Creation failed:", result.message);
      await logActivity(req, PANEL, MODULE, "create", result, false);
      return res.status(500).json({
        status: false,
        message: result.message || "Failed to create payment plan.",
      });
    }

    if (DEBUG) console.log("✅ STEP 4: Payment plan created:", result.data);
    await logActivity(req, PANEL, MODULE, "create", result, true);

    // ✅ Construct admin full name safely
    const adminFullName =
      req.admin?.name ||
      `${req.admin?.firstName || ""} ${req.admin?.lastName || ""}`.trim() ||
      "Unknown Admin";

    // ✅ Fixed notification message
    const msg = `Payment plan "${title}" created successfully ${adminFullName}`;

    await createNotification(req, "Payment Plan Created", msg, "Support");

    return res.status(201).json({
      status: true,
      message: "Payment plan created successfully.",
      data: result.data,
    });
  } catch (error) {
    console.error("❌ STEP 5: Server error during creation:", error);
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

// ✅ GET All Plans (by admin)
exports.getAllHolidayPaymentPlans = async (req, res) => {
  const adminId = req.admin?.id;
  if (DEBUG)
    console.log(`📦 Getting all payment groups for admin ID: ${adminId}`);

  if (DEBUG) console.log("📥 Fetching all payment plans...");
  const mainSuperAdminResult = await getMainSuperAdminOfAdmin(req.admin.id);
  const superAdminId = mainSuperAdminResult?.superAdmin.id ?? null;

  try {
    const result = await PaymentPlan.getAllHolidayPlans(superAdminId); // ✅ filtered by admin

    if (!result.status) {
      if (DEBUG) console.log("⚠️ Fetch failed:", result.message);
      await logActivity(req, PANEL, MODULE, "list", result, false);
      return res.status(500).json({ status: false, message: result.message });
    }

    if (DEBUG) {
      console.log("✅ Plans fetched successfully");
      console.table(result.data);
    }

    await logActivity(
      req,
      PANEL,
      MODULE,
      "list",
      {
        oneLineMessage: `Fetched ${result.data.length || 0} payment plan(s).`,
      },
      true
    );

    return res.status(200).json({
      status: true,
      message: "Fetched payment plans successfully.",
      data: result.data,
    });
  } catch (error) {
    console.error("❌ Error fetching all plans:", error);
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

// ✅ GET Plan by ID (restricted to admin)
exports.getHolidayPaymentPlanById = async (req, res) => {
  const { id } = req.params;
  const adminId = req.admin?.id;
  const mainSuperAdminResult = await getMainSuperAdminOfAdmin(req.admin.id);
  const superAdminId = mainSuperAdminResult?.superAdmin.id ?? null;

  if (DEBUG) console.log(`🔍 Fetching plan by ID: ${id}`);

  try {
    const result = await PaymentPlan.getHolidayPlanById(id, superAdminId); // ✅ adminId added

    if (!result.status) {
      if (DEBUG) console.log("⚠️ Plan not found:", result.message);
      await logActivity(req, PANEL, MODULE, "getById", result, false);
      return res.status(404).json({ status: false, message: result.message });
    }

    if (DEBUG) console.log("✅ Plan fetched:", result.data);
    await logActivity(
      req,
      PANEL,
      MODULE,
      "getById",
      {
        oneLineMessage: `Fetched plan with ID: ${id}`,
      },
      true
    );

    return res.status(200).json({
      status: true,
      message: "Payment plan fetched successfully.",
      data: result.data,
    });
  } catch (error) {
    console.error("❌ Error fetching plan by ID:", error);
    await logActivity(
      req,
      PANEL,
      MODULE,
      "getById",
      { oneLineMessage: error.message },
      false
    );
    return res.status(500).json({ status: false, message: "Server error." });
  }
};

// ✅ UPDATE Plan (restricted by admin)
exports.updateHolidayPaymentPlan = async (req, res) => {
  const { id } = req.params;
  const formData = req.body;
  const adminId = req.admin?.id;

  const { title, price, interval, duration, students } = formData;

  if (DEBUG) {
    console.log(`✏️ Updating plan with ID: ${id}`);
    console.log("📝 New Form Data:", formData);
  }

  const validation = validateFormData(formData, {
    requiredFields: [
      "title",
      "price",
      "interval",
      "duration",
      "students",
    ],
  });

  if (!validation.isValid) {
    if (DEBUG) console.log("❌ Validation Error:", validation.error);
    await logActivity(req, PANEL, MODULE, "update", validation.error, false);
    return res.status(400).json({
      status: false,
      error: validation.error,
      message: validation.message,
    });
  }

  try {
    const result = await PaymentPlan.updateHolidayPlan(id, adminId, {
      title,
      price,
      interval,
      duration,
      students,
    });

    if (!result.status) {
      if (DEBUG) console.log("⚠️ Update failed:", result.message);
      await logActivity(req, PANEL, MODULE, "update", result, false);
      return res.status(404).json({ status: false, message: result.message });
    }

    if (DEBUG) console.log("✅ Plan updated successfully:", result.data);
    await logActivity(
      req,
      PANEL,
      MODULE,
      "update",
      {
        oneLineMessage: `Updated plan with ID: ${id}`,
      },
      true
    );
    // ✅ Build admin full name safely
    const adminFullName =
      req.admin?.name ||
      `${req.admin?.firstName || ""} ${req.admin?.lastName || ""}`.trim() ||
      "Unknown Admin";

    // ✅ Fixed notification message
    const msg = `Payment plan "${title}" updated successfully by  ${adminFullName}`;

    await createNotification(req, "Payment Plan Updated", msg, "Support");

    return res.status(200).json({
      status: true,
      message: "Payment plan updated successfully.",
      data: result.data,
    });
  } catch (error) {
    console.error("❌ Error updating plan:", error);
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

exports.deleteHolidayPaymentPlan = async (req, res) => {
  const { id } = req.params;
  const adminId = req.admin?.id;

  if (!id) {
    return res.status(400).json({ status: false, message: "Plan ID is required." });
  }

  if (DEBUG) console.log(`🗑️ Deleting Payment Plan ID: ${id}`);

  try {
    // ✅ Fetch plan before deletion (use destructuring)
    const { status, data: plan, message } = await PaymentPlan.getHolidayPlanById(id, adminId);

    if (!status || !plan) {
      return res.status(404).json({ status: false, message });
    }

    // ✅ Perform soft delete
    const result = await PaymentPlan.deleteHolidayPlan(id, adminId);

    await logActivity(req, PANEL, MODULE, "delete", result, result.status);

    if (!result.status) {
      if (DEBUG) console.log("⚠️ Delete failed:", result.message);
      return res.status(404).json({ status: false, message: result.message });
    }

    // ✅ Build admin full name safely
    const adminFullName =
      req.admin?.name ||
      `${req.admin?.firstName || ""} ${req.admin?.lastName || ""}`.trim() ||
      "Unknown Admin";

    // ✅ Use correct plan title
    const planTitle = plan.title || "Unknown Plan";

    // ✅ Notification message
    const msg = `Payment plan "${planTitle}" deleted successfully by ${adminFullName}`;

    await createNotification(req, "Payment Plan Deleted", msg, "Support");

    if (DEBUG) console.log("✅ Payment plan deleted successfully");

    return res.status(200).json({
      status: true,
      message: "Payment plan deleted successfully.",
    });
  } catch (error) {
    console.error("❌ Error deleting payment plan:", error);
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

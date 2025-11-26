const paymentGroupModel = require("../../../../services/admin/holidayCamps/payment/holidayPaymentGroup");
const groupPlanService = require("../../../../services/admin/holidayCamps/payment/holidayPaymentGroupHasPlan");
const { HolidayPaymentPlan } = require("../../../../models");

const { validateFormData } = require("../../../../utils/validateFormData");
const { logActivity } = require("../../../../utils/admin/activityLogger");
const {
  createNotification,
} = require("../../../../utils/admin/notificationHelper");
const { getMainSuperAdminOfAdmin } = require("../../../../utils/auth");

const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "holiday-payment-group";

// ✅ Create a new payment group
exports.createHolidayPaymentGroup = async (req, res) => {
  const formData = req.body;
  const { name, description } = formData;
  let { plans } = formData;

  if (DEBUG) console.log("📥 Creating new payment group with data:", formData);

  const validation = validateFormData(formData, {
    requiredFields: ["name", "description"],
  });
  console.log(`req.admin - `, req.admin);

  if (!validation.isValid) {
    if (DEBUG) console.log("❌ Validation failed:", validation.error);
    await logActivity(req, PANEL, MODULE, "create", validation.error, false);
    return res.status(400).json({
      status: false,
      error: validation.error,
      message: validation.message,
    });
  }

  // ✅ Safely handle "plans"
  if (typeof plans === "string") {
    plans = plans
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
  } else if (!Array.isArray(plans)) {
    plans = [];
  }

  try {
    // STEP 1: Create the group
    const result = await paymentGroupModel.createHolidayPaymentGroup({
      name,
      description,
      plans,
      createdBy: req.admin.id,
    });

    if (!result.status) {
      console.warn("⚠️ Payment group creation failed:", result.message);
      await logActivity(req, PANEL, MODULE, "create", result, false);
      return res.status(500).json({
        status: false,
        message: result.message || "Failed to create payment group.",
      });
    }

    const groupId = result.data.id;

    // STEP 2: Remove any existing plans (cleanup)
    const existingPlanResult =
      await groupPlanService.getPaymentGroupAssignedPlans(
        groupId,
        req.admin.id
      );
    const existingPlans = existingPlanResult.status
      ? existingPlanResult.data
      : [];
    const newPlanIds = plans.map(String);
    const toRemove = existingPlans.filter((id) => !newPlanIds.includes(id));

    for (const planId of toRemove) {
      const removeResult = await groupPlanService.removePlanFromPaymentGroup(
        groupId,
        planId,
        req.admin.id
      );
      if (DEBUG) {
        console.log(
          removeResult.status
            ? `🗑️ Removed plan ID ${planId}`
            : `⚠️ Failed to remove plan ID ${planId}: ${removeResult.message}`
        );
      }
    }

    // STEP 3: Assign new plans
    const assigned = [];
    const skipped = [];

    for (const planId of plans) {
      const planCheck = await HolidayPaymentPlan.findByPk(planId);

      if (!planCheck) {
        skipped.push({ planId, reason: "Plan not found" });
        console.warn(`⛔ Skipped plan ID ${planId}: not found`);
        continue;
      }

      const assignResult = await groupPlanService.assignPlanToPaymentGroup(
        groupId,
        planId,
        req.admin.id
      );
      if (!assignResult.status) {
        skipped.push({ planId, reason: assignResult.message });
        console.warn(
          `⚠️ Failed to assign plan ID ${planId}: ${assignResult.message}`
        );
        continue;
      }

      if (DEBUG)
        console.log(`✅ Assigned plan ID ${planId} to group ${groupId}`);
      assigned.push(assignResult.data);
    }

    if (DEBUG) console.log("✅ Payment group created:", result.data);

    await logActivity(
      req,
      PANEL,
      MODULE,
      "create",
      {
        oneLineMessage: `Created payment group "${name}".`,
      },
      true
    );

    // ✅ Construct proper admin name
    const adminFullName = `${req.admin?.firstName || ""} ${req.admin?.lastName || ""}`.trim();

    const msg = `Payment group "${name}" created successfully by ${adminFullName || "Unknown Admin"}`;

    // ✅ Create notification with proper message
    await createNotification(req, "Payment Group Created", msg, "Support");

    return res.status(201).json({
      status: true,
      message: "Payment group created successfully.",
      data: result.data,
    });

    // return res.status(201).json({
    //   status: true,
    //   message: "Payment group created successfully.",
    //   data: result.data,
    // });
  } catch (error) {
    console.error("❌ Error creating payment group:", error);
    await logActivity(
      req,
      PANEL,
      MODULE,
      "create",
      { oneLineMessage: error.message },
      false
    );
    return res.status(500).json({
      status: false,
      message: "Server error occurred. Please try again later.",
    });
  }
};

exports.getAllHolidayPaymentGroups = async (req, res) => {
  const adminId = req.admin?.id;

  if (DEBUG)
    console.log(`📦 Getting all payment groups for admin ID: ${adminId}`);

  const mainSuperAdminResult = await getMainSuperAdminOfAdmin(req.admin.id);
  const superAdminId = mainSuperAdminResult?.superAdmin.id ?? null;

  try {
    const result = await paymentGroupModel.getAllHolidayPaymentGroups(superAdminId);

    await logActivity(req, PANEL, MODULE, "getAll", result, result.status);

    if (!result.status) {
      return res.status(400).json({ status: false, message: result.message });
    }

    return res.status(200).json({
      status: true,
      message: result.message,
      data: result.data,
    });
  } catch (error) {
    console.error("❌ getAllPaymentGroups Error:", error);
    await logActivity(req, PANEL, MODULE, "getAll", error, false);
    return res.status(500).json({
      status: false,
      message: "Internal server error",
    });
  }
};

exports.getHolidayPaymentGroupById = async (req, res) => {
  const { id } = req.params;
  const adminId = req.admin?.id;

  if (DEBUG)
    console.log(`🔍 Fetching payment group by ID: ${id}, admin ID: ${adminId}`);

  const mainSuperAdminResult = await getMainSuperAdminOfAdmin(req.admin.id);
  const superAdminId = mainSuperAdminResult?.superAdmin.id ?? null;

  try {
    const result = await paymentGroupModel.getHolidayPaymentGroupById(id, superAdminId);

    await logActivity(req, PANEL, MODULE, "getById", result, result.status);

    if (!result.status || !result.data) {
      return res.status(404).json({
        status: false,
        message: result.message || "Payment group not found",
      });
    }

    return res.status(200).json({
      status: true,
      message: result.message,
      data: result.data,
    });
  } catch (error) {
    console.error("❌ getPaymentGroupById Error:", error);
    await logActivity(req, PANEL, MODULE, "getById", error, false);
    return res.status(500).json({
      status: false,
      message: "Internal server error",
    });
  }
};

exports.updateHolidayPaymentGroup = async (req, res) => {
  const { id } = req.params;
  const formData = req.body;
  const adminId = req.admin?.id;

  const { name, description } = formData;
  let { plans } = formData;

  if (DEBUG)
    console.log(`✏️ Updating payment group ID: ${id} with data:`, formData);

  const validation = validateFormData(formData, {
    requiredFields: ["name", "description"],
  });

  if (!validation.isValid) {
    if (DEBUG) console.log("❌ Validation failed:", validation.error);
    await logActivity(req, PANEL, MODULE, "update", validation.error, false);
    return res.status(400).json({
      status: false,
      error: validation.error,
      message: validation.message,
    });
  }

  if (typeof plans === "string") {
    plans = plans
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
  } else if (!Array.isArray(plans)) {
    plans = [];
  }

  try {
    // Step 1: Update basic info
    const result = await paymentGroupModel.updateHolidayPaymentGroup(id, adminId, {
      name,
      description,
    });

    if (!result.status) {
      if (DEBUG)
        console.warn("⚠️ Failed to update payment group:", result.message);
      await logActivity(req, PANEL, MODULE, "update", result, false);
      return res.status(404).json({ status: false, message: result.message });
    }

    // Step 2: Plan assignment
    const existingResult = await groupPlanService.getPaymentGroupAssignedPlans(
      id,
      adminId
    );
    const existingPlans = existingResult.status
      ? existingResult.data.map(String)
      : [];

    const newPlanIds = plans.map(String);

    const toRemove = existingPlans.filter((id) => !newPlanIds.includes(id));
    const toAdd = newPlanIds.filter((id) => !existingPlans.includes(id));

    if (DEBUG)
      console.log(
        "🔁 Reassigning plans. To Add:",
        toAdd,
        "To Remove:",
        toRemove
      );

    for (const planId of toRemove) {
      // const removeResult = await groupPlanService.removePlanFromPaymentGroup(
      //   id,
      //   planId
      // );
      const removeResult = await groupPlanService.removePlanFromPaymentGroup(
        id,
        planId,
        adminId
      );
      if (DEBUG) {
        console.log(
          removeResult.status
            ? `🗑️ Removed plan ID ${planId}`
            : `⚠️ Failed to remove plan ID ${planId}: ${removeResult.message}`
        );
      }
    }

    for (const planId of toAdd) {
      const planExists = await HolidayPaymentPlan.findByPk(planId);
      if (!planExists) {
        console.warn(`⛔ Skipped non-existent plan ID ${planId}`);
        continue;
      }

      // const assignResult = await groupPlanService.assignPlanToPaymentGroup(
      //   id,
      //   planId
      // );
      const assignResult = await groupPlanService.assignPlanToPaymentGroup(
        id,
        planId,
        adminId
      );
      if (!assignResult.status && DEBUG) {
        console.warn(
          `⚠️ Failed to assign plan ID ${planId}: ${assignResult.message}`
        );
      } else {
        if (DEBUG) console.log(`✅ Assigned plan ID ${planId} to group ${id}`);
      }
    }

    if (DEBUG) console.log("✅ Finished updating payment group:", result.data);

    await logActivity(
      req,
      PANEL,
      MODULE,
      "update",
      { oneLineMessage: `Updated payment group ID: ${id}` },
      true
    );
    // ✅ Build admin full name safely
    const adminFullName =
      req.admin?.name ||
      `${req.admin?.firstName || ""} ${req.admin?.lastName || ""}`.trim() ||
      "Unknown Admin";

    // ✅ Fixed notification message (correct wording + proper name)
    const msg = `Payment group "${name}" updated successfully by ${adminFullName}`;

    await createNotification(req, "Payment Group Updated", msg, "Support");

    return res.status(200).json({
      status: true,
      message: "Payment group updated successfully.",
      data: result.data,
    });
  } catch (error) {
    console.error("❌ Error updating payment group:", error);
    await logActivity(
      req,
      PANEL,
      MODULE,
      "update",
      { oneLineMessage: error.message },
      false
    );
    return res.status(500).json({
      status: false,
      message: "Server error occurred.",
    });
  }
};

// // ✅ Delete a payment group
// exports.deletePaymentGroup = async (req, res) => {
//   const { id } = req.params;
//   const adminId = req.admin?.id;

//   if (DEBUG) console.log(`🗑️ Deleting payment group ID: ${id}`);

//   try {
//     // Step 1: Fetch group by ID to ensure it exists
//     const groupResult = await paymentGroupModel.getPaymentGroupById(
//       id,
//       adminId
//     ); // ⬅️ Pass adminId here

//     if (!groupResult.status || !groupResult.data) {
//       const notFoundMsg =
//         groupResult.message || `Payment group with ID ${id} not found.`;
//       console.warn("⚠️", notFoundMsg);
//       await logActivity(req, PANEL, MODULE, "getById", groupResult, false);

//       return res.status(404).json({ status: false, message: notFoundMsg });
//     }

//     const paymentGroup = groupResult.data;

//     // Step 2: Delete the group
//     const deleteResult = await paymentGroupModel.deletePaymentGroup(
//       id,
//       adminId
//     ); // ⬅️ Also pass here

//     if (!deleteResult.status) {
//       console.warn("⚠️ Failed to delete payment group:", deleteResult.message);
//       await logActivity(req, PANEL, MODULE, "delete", deleteResult, false);

//       return res
//         .status(500)
//         .json({ status: false, message: deleteResult.message });
//     }

//     const successMsg = `Payment group "${paymentGroup.name}" deleted by Admin: ${req.admin?.name}`;
//     if (DEBUG) console.log("✅", successMsg);

//     await logActivity(
//       req,
//       PANEL,
//       MODULE,
//       "delete",
//       { oneLineMessage: successMsg },
//       true
//     );
//     await createNotification(
//       req,
//       "Payment Group Deleted",
//       successMsg,
//       "Payment Groups"
//     );

//     return res.status(200).json({
//       status: true,
//       message: "Payment group deleted successfully.",
//     });
//   } catch (error) {
//     const errorMsg =
//       error?.message || "Unexpected error while deleting the payment group.";
//     console.error("❌ Error deleting payment group:", error);

//     await logActivity(
//       req,
//       PANEL,
//       MODULE,
//       "delete",
//       { oneLineMessage: errorMsg },
//       false
//     );
//     return res
//       .status(500)
//       .json({ status: false, message: "Server error occurred." });
//   }
// };

// ✅ Soft delete payment group (controller)
exports.deleteHolidayPaymentGroup = async (req, res) => {
  const { id } = req.params;
  const adminId = req.admin?.id;

  if (!id) {
    return res.status(400).json({
      status: false,
      message: "Payment group ID is required.",
    });
  }

  if (DEBUG) console.log(`🗑️ deleting Payment Group ID: ${id}`);

  try {
    // Step 1: Ensure the group exists (and not already soft-deleted)
    const groupResult = await paymentGroupModel.getHolidayPaymentGroupById(id, adminId);

    if (!groupResult.status || !groupResult.data) {
      const notFoundMsg = groupResult.message || `Payment group with ID ${id} not found.`;
      await logActivity(req, PANEL, MODULE, "getById", groupResult, false);
      return res.status(404).json({ status: false, message: notFoundMsg });
    }

    const paymentGroup = groupResult.data;

    // Step 2: Perform soft delete
    const deleteResult = await paymentGroupModel.deleteHolidayPaymentGroup(id, adminId);

    if (!deleteResult.status) {
      await logActivity(req, PANEL, MODULE, "delete", deleteResult, false);
      return res.status(400).json({ status: false, message: deleteResult.message });
    }

    // ✅ Step 3: Build admin full name safely
    const adminFullName =
      req.admin?.name ||
      `${req.admin?.firstName || ""} ${req.admin?.lastName || ""}`.trim() ||
      "Unknown Admin";

    // ✅ Step 4: Log + Notify with proper message
    const successMsg = `Payment group "${paymentGroup.name}" deleted successfully by ${adminFullName}`;

    await logActivity(
      req,
      PANEL,
      MODULE,
      "delete",
      { oneLineMessage: successMsg },
      true
    );

    await createNotification(req, "Payment Group Deleted", successMsg, "Support");

    return res.status(200).json({
      status: true,
      message: "Payment group deleted successfully.",
    });
  } catch (error) {
    console.error("❌ Error in deletePaymentGroup Controller:", error);

    await logActivity(
      req,
      PANEL,
      MODULE,
      "delete",
      { oneLineMessage: error.message },
      false
    );

    return res.status(500).json({
      status: false,
      message: "Server error occurred while deleting the payment group.",
    });
  }
};

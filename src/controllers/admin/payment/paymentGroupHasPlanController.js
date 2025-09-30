const paymentGroupModel = require("../../../services/admin/payment/paymentGroup");
const groupPlanService = require("../../../services/admin/payment/paymentGroupHasPlan");
const { logActivity } = require("../../../utils/admin/activityLogger");
const PaymentPlan = require("../../../services/admin/payment/paymentPlan");
const { validateFormData } = require("../../../utils/validateFormData");

const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "payment-group";

exports.assignPlansToPaymentGroup = async (req, res) => {
  const { id: groupId } = req.params;
  const formData = req.body;
  const createdBy = req.admin?.id;

  const DEBUG = process.env.DEBUG === "true";
  const PANEL = "Admin";
  const MODULE = "PaymentGroup";

  let plans = formData.plans || formData.planIds;

  // STEP 1: Initial logs
  if (DEBUG) {
    console.log("📥 STEP 1: Received request to assign plans to payment group");
    console.log("📝 Request Body:", formData);
  }

  // STEP 2: Validate group existence
  const groupResult = await paymentGroupModel.getPaymentGroupById(
    groupId,
    createdBy
  );
  if (!groupResult.status) {
    const message = groupResult.message || "Payment group not found.";
    if (DEBUG) {
      console.log("❌ STEP 2: Payment group not found");
      console.log(`🔍 Group ID: ${groupId}`);
    }
    await logActivity(
      req,
      PANEL,
      MODULE,
      "assignPlans",
      { oneLineMessage: message },
      false
    );
    return res.status(404).json({ status: false, message });
  }

  if (DEBUG) {
    console.log("✅ STEP 2: Payment group found");
    console.log("🏷️ Group Name:", groupResult.data.name || groupId);
  }

  // STEP 3: Normalize input
  if (!plans) {
    const message = "plans or planIds is required.";
    if (DEBUG) console.log("❌ STEP 3:", message);
    await logActivity(
      req,
      PANEL,
      MODULE,
      "assignPlans",
      { oneLineMessage: message },
      false
    );
    return res.status(400).json({ status: false, message });
  }

  // Normalize comma-separated string → array
  if (typeof plans === "string") {
    plans = plans
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
  }

  if (!Array.isArray(plans) || plans.length === 0) {
    const message = "plans must be a non-empty array.";
    if (DEBUG) console.log("❌ STEP 3: ", message);
    await logActivity(
      req,
      PANEL,
      MODULE,
      "assignPlans",
      { oneLineMessage: message },
      false
    );
    return res.status(400).json({ status: false, message });
  }

  if (DEBUG) {
    console.log("✅ STEP 3: Normalized plans array");
    console.log("📦 Plan IDs:", plans);
  }

  try {
    // STEP 4: Fetch current assigned plans
    // const existingPlanResult =
    //   await groupPlanService.getPaymentGroupAssignedPlans(groupId);
    const existingPlanResult =
      await groupPlanService.getPaymentGroupAssignedPlans(groupId, createdBy);

    if (!existingPlanResult.status) {
      const message =
        existingPlanResult.message || "Failed to fetch existing assignments.";
      if (DEBUG) {
        console.log("❌ STEP 4:", message);
        console.log("⚠️ Error:", existingPlanResult.message);
      }
      await logActivity(
        req,
        PANEL,
        MODULE,
        "assignPlans",
        { oneLineMessage: message },
        false
      );
      return res.status(500).json({ status: false, message });
    }

    const existingPlans = existingPlanResult.data.map(String);
    const newPlans = plans.map(String);
    const toRemove = existingPlans.filter((id) => !newPlans.includes(id));

    if (DEBUG) {
      console.log("📊 STEP 4: Comparing plans");
      console.log("🟡 Existing:", existingPlans);
      console.log("🟢 Incoming:", newPlans);
      console.log("🔴 To Remove:", toRemove);
    }

    // STEP 5: Remove old plans
    for (const planId of toRemove) {
      const removeResult = await groupPlanService.removePlanFromPaymentGroup(
        groupId,
        planId
      );
      if (DEBUG) {
        console.log(
          removeResult.status
            ? `🗑️ Removed plan ID ${planId}`
            : `⚠️ Failed to remove plan ID ${planId}: ${removeResult.message}`
        );
      }
    }

    // STEP 6: Assign new plans
    const assigned = [];
    const skipped = [];

    for (const planId of newPlans) {
      const planCheck = await PaymentPlan.getPlanById(planId, createdBy); // ✅ add createdBy here
      if (!planCheck.status) {
        skipped.push({ planId, reason: "Plan does not exist" });
        if (DEBUG) console.log(`⛔ Skipped plan ID ${planId}: Not found`);
        continue;
      }

      const assignResult = await groupPlanService.assignPlanToPaymentGroup(
        groupId,
        planId,
        createdBy
      );
      if (!assignResult.status) {
        skipped.push({ planId, reason: assignResult.message });
        if (DEBUG) {
          console.log(
            `⚠️ Failed to assign plan ID ${planId}: ${assignResult.message}`
          );
        }
        continue;
      }

      if (DEBUG) console.log(`✅ Assigned plan ID ${planId} to group`);
      assigned.push(assignResult.data);
    }

    // STEP 7: Summary and Response
    const summary = {
      oneLineMessage: `Assigned ${assigned.length} plan(s) to group ${groupId}.`,
      assigned: assigned.map((a) => a.payment_plan_id),
      removed: toRemove,
      skipped,
    };

    if (DEBUG) {
      console.log("📊 STEP 7: Final Summary");
      console.log("🟢 Assigned:", summary.assigned);
      console.log("🔴 Removed:", summary.removed);
      if (skipped.length) console.log("⚠️ Skipped:", skipped);
    }

    await logActivity(req, PANEL, MODULE, "assignPlans", summary, true);

    return res.status(200).json({
      status: true,
      message: "Plan assignment process completed.",
      assigned,
      removed: toRemove,
      skipped: skipped.length ? skipped : undefined,
    });
  } catch (error) {
    console.error("❌ STEP 8: Unexpected error", error);
    await logActivity(
      req,
      PANEL,
      MODULE,
      "assignPlans",
      { oneLineMessage: error.message },
      false
    );
    return res.status(500).json({
      status: false,
      message: "Server error while assigning plans.",
    });
  }
};

// exports.assignPlansToPaymentGroup = async (req, res) => {
//   const { id: groupId } = req.params;
//   const formData = req.body;
//   const createdBy = req.admin?.id;
//   let { plans } = formData;

//   if (DEBUG) {
//     console.log("📥 STEP 1: Received request to assign plans");
//     console.log("📝 Request Body:", formData);
//   }

//   // STEP 2: Validate group existence
//   const groupResult = await paymentGroupModel.getPaymentGroupById(groupId);

//   if (!groupResult.status) {
//     const message = groupResult.message || "Group not found.";
//     if (DEBUG) {
//       console.log("❌ STEP 2: Group does not exist");
//       console.log(`🔎 Group ID: ${groupId} not found`);
//     }
//     await logActivity(
//       req,
//       PANEL,
//       MODULE,
//       "assignPlans",
//       { oneLineMessage: message },
//       false
//     );
//     return res.status(404).json({ status: false, message });
//   }

//   if (DEBUG) {
//     console.log("✅ STEP 2: Group found");
//     console.log("🏷️ Group:", groupResult.data.name || groupId);
//   }

//   // STEP 3: Validate input
//   const validation = validateFormData(formData, {
//     requiredFields: ["plans"],
//   });

//   if (!validation.isValid) {
//     if (DEBUG) {
//       console.log("❌ STEP 3: Validation failed");
//       console.log("🚫 Validation Error:", validation.error);
//     }
//     await logActivity(
//       req,
//       PANEL,
//       MODULE,
//       "assignPlans",
//       validation.error,
//       false
//     );
//     return res.status(400).json({
//       status: false,
//       error: validation.error,
//       message: validation.message,
//     });
//   }

//   // STEP 4: Normalize plans
//   if (typeof plans === "string") {
//     plans = plans
//       .split(",")
//       .map((id) => id.trim())
//       .filter(Boolean);
//   }

//   if (!Array.isArray(plans) || plans.length === 0) {
//     const message = "plans must be a non-empty array.";
//     if (DEBUG) console.log("❌ STEP 4:", message);
//     await logActivity(
//       req,
//       PANEL,
//       MODULE,
//       "assignPlans",
//       { oneLineMessage: message },
//       false
//     );
//     return res.status(400).json({ status: false, message });
//   }

//   if (DEBUG) {
//     console.log("✅ STEP 4: Normalized plans");
//     console.log("📦 Plan IDs:", plans);
//   }

//   try {
//     // STEP 5: Fetch current assigned plans
//     const existingPlanResult =
//       await groupPlanService.getPaymentGroupAssignedPlans(groupId);

//     if (!existingPlanResult.status) {
//       if (DEBUG) {
//         console.log("❌ STEP 5: Failed to fetch assigned plans");
//         console.log("⚠️ Error:", existingPlanResult.message);
//       }
//       await logActivity(
//         req,
//         PANEL,
//         MODULE,
//         "assignPlans",
//         existingPlanResult,
//         false
//       );
//       return res.status(500).json({
//         status: false,
//         message: "Failed to fetch existing plan assignments.",
//       });
//     }

//     const existingplans = existingPlanResult.data;
//     const newplans = plans.map(String);
//     const toRemove = existingplans.filter((id) => !newplans.includes(id));

//     if (DEBUG) {
//       console.log("📂 STEP 5: Plan comparison complete");
//       console.log("🟡 Existing:", existingplans);
//       console.log("🟢 Incoming:", newplans);
//       console.log("🔴 To Remove:", toRemove);
//     }

//     // STEP 6: Remove old plans
//     for (const planId of toRemove) {
//       const removeResult = await groupPlanService.removePlanFromPaymentGroup(
//         groupId,
//         planId
//       );
//       if (DEBUG) {
//         console.log(
//           removeResult.status
//             ? `🗑️ Removed plan ID ${planId}`
//             : `⚠️ Failed to remove plan ID ${planId}: ${removeResult.message}`
//         );
//       }
//     }

//     // STEP 7: Assign new plans
//     const assigned = [];
//     const skipped = [];

//     for (const planId of plans) {
//       const planCheck = await PaymentPlan.getPlanById(planId);

//       if (!planCheck.status) {
//         skipped.push({ planId, reason: "Plan does not exist" });
//         if (DEBUG) console.log(`⛔ Skipped plan ID ${planId}: Plan not found`);
//         continue;
//       }

//       const assignResult = await groupPlanService.assignPlanToPaymentGroup(
//         groupId,
//         planId,
//         createdBy
//       );

//       if (!assignResult.status) {
//         skipped.push({ planId, reason: assignResult.message });
//         if (DEBUG)
//           console.log(
//             `⚠️ Failed to assign plan ID ${planId}: ${assignResult.message}`
//           );
//         continue;
//       }

//       if (DEBUG)
//         console.log(`✅ Assigned plan ID ${planId} to group ${groupId}`);
//       assigned.push(assignResult.data);
//     }

//     // STEP 8: Final Summary
//     const summary = {
//       oneLineMessage: `Assigned ${assigned.length} plan(s) to group ${groupId}.`,
//       assigned: assigned.map((r) => r.payment_plan_id),
//       removed: toRemove,
//       skipped,
//     };

//     if (DEBUG) {
//       console.log("📊 STEP 8: Summary of Assignment");
//       console.log("🟢 Assigned:", summary.assigned);
//       console.log("🔴 Removed:", summary.removed);
//       if (skipped.length > 0) console.log("⚠️ Skipped:", skipped);
//     }

//     await logActivity(req, PANEL, MODULE, "assignPlans", summary, true);

//     return res.status(200).json({
//       status: true,
//       message: "Plan assignment process completed.",
//       assigned,
//       removed: toRemove,
//       skipped: skipped.length ? skipped : undefined,
//     });
//   } catch (error) {
//     console.error("❌ STEP 9: Unexpected server error", error);
//     await logActivity(
//       req,
//       PANEL,
//       MODULE,
//       "assignPlans",
//       { oneLineMessage: error.message },
//       false
//     );
//     return res.status(500).json({
//       status: false,
//       message: "Server error while assigning plans.",
//     });
//   }
// };

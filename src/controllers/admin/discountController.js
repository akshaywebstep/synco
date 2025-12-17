// controllers/admin/discount.js

const discountService = require("../../services/admin/discount");
const { validateFormData } = require("../../utils/validateFormData");

const { logActivity } = require("../../utils/admin/activityLogger");
const { createNotification } = require("../../utils/admin/notificationHelper");

const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "discount";

// ✅ Create Discount
exports.createDiscount = async (req, res) => {
  try {
    const formData = req.body;

    if (DEBUG) {
      console.log("🟡 [Step 1] Received request to create discount.");
      console.log("📥 Form Data:", JSON.stringify(formData, null, 2));
    }

    const validation = validateFormData(formData, {
      requiredFields: [
        "type",
        "code",
        "valueType",
        "value",
        "applyOncePerOrder",
        "limitTotalUses",
        "limitPerCustomer",
        "startDatetime",
        "endDatetime",
        "appliesTo",
      ],
      patternValidations: {
        value: "decimal",
        startDatetime: "datetime",
      },
    });

    if (!validation.isValid) {
      if (DEBUG) console.log("❌ Validation failed:", validation.error);

      await logActivity(req, PANEL, MODULE, "create", validation.error, false);
      return res.status(400).json({
        status: false,
        error: validation.error,
        message: validation.message,
      });
    }

    if (DEBUG) console.log("✅ Validation passed. Checking discount code...");

    const { code } = formData;
    const discountByCodeResult = await discountService.getDiscountByCode(code);

    if (discountByCodeResult.status) {
      const message = "This discount code is already in use.";
      await logActivity(
        req,
        PANEL,
        MODULE,
        "create",
        { oneLineMessage: message },
        false
      );
      return res.status(400).json({ status: false, message });
    }

    if (DEBUG)
      console.log("✅ Discount code is available. Creating discount...");

    const {
      type,
      valueType,
      value,
      applyOncePerOrder,
      limitTotalUses,
      limitPerCustomer,
      startDatetime,
      endDatetime,
      appliesTo,
    } = formData;

    const discountPayload = {
      type,
      code,
      valueType,
      value,
      applyOncePerOrder,
      limitTotalUses,
      limitPerCustomer,
      startDatetime,
      endDatetime,
    };

    const discountCreateResult = await discountService.createDiscount(
      discountPayload
    );

    if (!discountCreateResult.status) {
      await logActivity(
        req,
        PANEL,
        MODULE,
        "create",
        discountCreateResult,
        false
      );
      return res.status(500).json({
        status: false,
        message: discountCreateResult.message || "Failed to create discount.",
      });
    }

    const discount = discountCreateResult.data;

    if (DEBUG)
      console.log("✅ Discount created successfully. Applying to targets...");

    const existingTargetsResult =
      await discountService.getDiscountAppliedToByDiscountId(discount.id);
    const existingTargets = existingTargetsResult.status
      ? existingTargetsResult.data.map((item) => item.appliesTo)
      : [];

    for (const item of appliesTo) {
      if (existingTargets.includes(item)) {
        console.warn(`⚠️ Skipping duplicate apply target: ${item}`);
        continue;
      }

      const appliesToPayload = {
        discountId: discount.id,
        target: item,
      };

      const applyResult = await discountService.createDiscountAppliesTo(
        appliesToPayload
      );
      if (!applyResult.status) {
        await logActivity(
          req,
          PANEL,
          MODULE,
          "create",
          { oneLineMessage: `Failed to apply discount to ${item}` },
          false
        );
        return res.status(500).json({
          status: false,
          message: `Failed to apply discount to: ${item}. ${applyResult.message}`,
        });
      }
    }

    const successMessage = `Discount '${code}' created successfully by Admin: ${req?.admin?.firstName || "Admin"} ${req?.admin?.lastName || ""}`;
    if (DEBUG) console.log("✅", successMessage);

    await logActivity(
      req,
      PANEL,
      MODULE,
      "create",
      { oneLineMessage: successMessage },
      true
    );
    await createNotification(
      req,
      "New Discount Created",
      successMessage,
      "Discounts"
    );

    return res.status(201).json({
      status: true,
      message: "Discount created successfully.",
      data: discount,
    });
  } catch (error) {
    console.error("❌ Create Discount Error:", error);
    return res.status(500).json({
      status: false,
      message:
        "Server error occurred while creating the discount. Please try again later.",
    });
  }
};

// ✅ Get All Discounts
exports.getAllDiscounts = async (req, res) => {
  if (DEBUG) console.log("📋 [Step 1] Request received to fetch all discounts");

  try {
    const result = await discountService.getAllDiscounts();

    if (!result.status) {
      const errorMsg = result.message || "Failed to fetch discounts.";
      if (DEBUG) console.log("❌ Failed to fetch discounts:", errorMsg);

      await logActivity(
        req,
        PANEL,
        MODULE,
        "list",
        { oneLineMessage: errorMsg },
        false
      );

      return res.status(500).json({
        status: false,
        message: errorMsg,
      });
    }

    const count = result.data.length;
    const message = `Fetched ${count} discount${count === 1 ? "" : "s"
      } successfully.`;

    if (DEBUG) {
      console.log(`✅ ${message}`);
      console.table(
        result.data.map((d) => ({
          ID: d.id,
          Code: d.code,
          Type: d.type,
          Value: d.value,
          ActiveFrom: d.startDatetime,
          ActiveTo: d.endDatetime,
        }))
      );
    }

    await logActivity(
      req,
      PANEL,
      MODULE,
      "list",
      { oneLineMessage: message },
      true
    );

    return res.status(200).json({
      status: true,
      message,
      data: result.data,
    });
  } catch (error) {
    console.error("❌ Get All Discounts Error:", error);
    return res.status(500).json({
      status: false,
      message:
        "Server error occurred while fetching discounts. Please try again later.",
    });
  }
};

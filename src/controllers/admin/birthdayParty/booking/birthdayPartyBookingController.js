const { validateFormData } = require("../../../../utils/validateFormData");
const birthdayPartyBookingService = require("../../../../services/admin/birthdayParty/booking/birthdayPartyBooking");
const { logActivity } = require("../../../../utils/admin/activityLogger");

const {
  createNotification,
} = require("../../../../utils/admin/notificationHelper");

const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "birthday-party-Booking";

// create
exports.createBirthdayPartyBooking = async (req, res) => {
  try {
    const adminId = req.admin?.id || null;
    const formData = req.body;

    if (DEBUG)
      console.log(
        "📥 Incoming booking data:",
        JSON.stringify(formData, null, 2)
      );

    // ✅ Step 1: Validate required main fields (stop at first missing)
    const requiredFields = [
      "leadId",
      "coachId",
      "paymentPlanId",
      "address",
      "date",
      "time",
      "capacity",
    ];

    for (const field of requiredFields) {
      if (!formData[field] || formData[field] === "") {
        return res.status(400).json({
          success: false,
          message: `${field} is required`,
        });
      }
    }

    // ✅ Step 2: Validate nested arrays
    if (!Array.isArray(formData.students) || formData.students.length === 0) {
      return res.status(400).json({
        success: false,
        message: "At least one student is required",
      });
    }

    if (!Array.isArray(formData.parents) || formData.parents.length === 0) {
      return res.status(400).json({
        success: false,
        message: "At least one parent is required",
      });
    }

    if (!formData.emergency) {
      return res.status(400).json({
        success: false,
        message: "Emergency contact details are required",
      });
    }

    // ✅ Step 3: Validate student fields
    for (const [index, student] of formData.students.entries()) {
      const requiredStudentFields = ["studentFirstName", "studentLastName", "dateOfBirth"];

      for (const field of requiredStudentFields) {
        if (!student[field] || student[field].toString().trim() === "") {
          return res.status(400).json({
            success: false,
            message: `Student ${index + 1} ${field} is required`,
          });
        }
      }
    }

    // ✅ Step 4: Validate parent fields
    for (const [index, parent] of formData.parents.entries()) {
      const requiredParentFields = [
        "parentFirstName",
        "parentLastName",
        "parentEmail",
        "phoneNumber",
        "relationChild",
        "howDidHear",
      ];

      for (const field of requiredParentFields) {
        if (!parent[field] || parent[field].toString().trim() === "") {
          return res.status(400).json({
            success: false,
            message: `Parent ${index + 1} ${field} is required`,
          });
        }
      }
    }

    // ✅ Step 5: Validate emergency contact fields
    const requiredEmergencyFields = [
      "emergencyFirstName",
      "emergencyLastName",
      "emergencyPhoneNumber",
      "emergencyRelation",
    ];

    for (const field of requiredEmergencyFields) {
      if (
        !formData.emergency[field] ||
        formData.emergency[field].toString().trim() === ""
      ) {
        return res.status(400).json({
          success: false,
          message: `Emergency ${field} is required`,
        });
      }
    }

    // ✅ Step 6: Validate payment fields (if provided)
    if (formData.payment) {
      const requiredPaymentFields = [
        "firstName",
        "lastName",
        "email",
        "billingAddress",
      ];

      for (const field of requiredPaymentFields) {
        if (!formData.payment[field] || formData.payment[field].toString().trim() === "") {
          return res.status(400).json({
            success: false,
            message: `Payment ${field} is required`,
          });
        }
      }
    }

    // ✅ Step 5: Create booking via service
    const result = await birthdayPartyBookingService.createBirthdayPartyBooking(formData);

    // ⚠️ Handle duplicate lead (service layer returns this)
    if (result?.message === "You have already booked this lead.") {
      return res.status(400).json({
        success: false,
        message: "You have already booked this lead.",
      });
    }

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.message || "Failed to create booking",
      });
    }

    if (DEBUG) console.log("✅ Booking created successfully:", result);

    // ✅ Step 6: Log and notify
    await logActivity(req, PANEL, MODULE, "create", formData.data, true);
    await createNotification(
      req,
      "Booking Created Successfully",
      `The booking was created by ${req?.admin?.firstName || "Admin"} ${req?.admin?.lastName || ""
      }.`,
      "System"
    );

    // ✅ Step 7: Response
    return res.status(201).json({
      success: true,
      message: "Birthday party booking created successfully",
      data: result,
    });
  } catch (error) {
    if (DEBUG) console.error("❌ Error in createBirthday Party Booking:", error);

    return res.status(500).json({
      success: false,
      message: DEBUG ? error.message : "Internal server error",
    });
  }
};

exports.getAdminsPaymentPlanDiscount = async (req, res) => {
  try {
    const admin = req.admin || {};
    const adminId = admin.id || null;

    // ✅ Automatically determine superAdminId from logged-in admin
    const superAdminId =
      admin.role === "Super Admin" || !admin.superAdminId
        ? admin.id
        : admin.superAdminId;

    // ✅ Determine if we should include super admin data
    const includeSuperAdmin =
      req.query.includeSuperAdmin === "true" ||
      req.query.includeSuperAdmin === true;

    if (DEBUG) {
      console.log("📥 Incoming GET query (auto-detected superAdminId):", {
        adminId,
        role: admin.role,
        superAdminId,
        includeSuperAdmin,
      });
    }

    // ✅ Validate superAdminId and adminId
    if (!superAdminId || isNaN(Number(superAdminId))) {
      return res.status(400).json({
        success: false,
        message: "Unable to detect a valid superAdminId from logged-in admin.",
      });
    }

    if (!adminId || isNaN(Number(adminId))) {
      return res.status(400).json({
        success: false,
        message: "Invalid or missing adminId from session.",
      });
    }

    // ✅ Call the service (pass both superAdminId and adminId)
    const result = await birthdayPartyBookingService.getAdminsPaymentPlanDiscount({
      superAdminId,
      adminId,
      includeSuperAdmin,
    });

    if (!result.status) {
      return res.status(400).json({
        success: false,
        message: result.message || "Failed to fetch admin payment plan data.",
      });
    }

    if (DEBUG) console.log("✅ Service result:", result);

    // ✅ Log the action for auditing
    await logActivity(
      req,
      PANEL,
      MODULE,
      "fetch",
      { adminId, superAdminId, includeSuperAdmin },
      true
    );

    // ✅ Send final structured response (unchanged)
    return res.status(200).json({
      success: true,
      message: result.message,
      data: result.data,
    });
  } catch (error) {
    console.error("❌ Error in getAdminsPaymentPlanDiscount:", error);

    return res.status(500).json({
      success: false,
      message: DEBUG
        ? error.message
        : "Internal server error while fetching admins payment plan discount data.",
    });
  }
};

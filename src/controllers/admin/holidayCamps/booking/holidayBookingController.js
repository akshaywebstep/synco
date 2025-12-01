const { validateFormData } = require("../../../../utils/validateFormData");
const holidayBookingService = require("../../../../services/admin/holidayCamps/booking/holidayBooking");
const { logActivity } = require("../../../../utils/admin/activityLogger");

const {
  createNotification,
} = require("../../../../utils/admin/notificationHelper");
const { getMainSuperAdminOfAdmin } = require("../../../../utils/auth");

const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "holiday-booking";

// create
exports.createHolidayBooking = async (req, res) => {
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
      "discountId",
      "venueId",
      "paymentPlanId",
      "totalStudents",
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
      const requiredStudentFields = ["studentFirstName", "studentLastName", "dateOfBirth", "medicalInformation"];

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
        "parentPhoneNumber",
        "relationToChild",
        "howDidYouHear",
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
    const result = await holidayBookingService.createHolidayBooking(formData, adminId);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.message || "Failed to create booking",
      });
    }

    if (DEBUG) console.log("✅ Holiday Booking created successfully:", result);

    // ✅ Step 6: Log and notify
    await logActivity(req, PANEL, MODULE, "create", formData.data, true);
    await createNotification(
      req,
      "Holiday Booking Created Successfully",
      `The booking was created by ${req?.admin?.firstName || "Admin"} ${req?.admin?.lastName || ""
      }.`,
      "System"
    );

    // ✅ Step 7: Response
    return res.status(201).json({
      success: true,
      message: "Holiday Booking created successfully",
      data: result,
    });
  } catch (error) {
    if (DEBUG) console.error("❌ Error in createHolidayBooking Booking:", error);

    return res.status(500).json({
      success: false,
      message: DEBUG ? error.message : "Internal server error",
    });
  }
};

exports.getAllHolidayBooking = async (req, res) => {
  const adminId = req.admin?.id;

  try {
    // Validate admin
    if (!adminId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: Admin ID not found.",
      });
    }

    // 🔹 Identify super admin
    const mainSuperAdminResult = await getMainSuperAdminOfAdmin(adminId);
    const superAdminId = mainSuperAdminResult?.superAdmin?.id ?? null;

    // 🔹 Fetch data from service
    const result = await holidayBookingService.getHolidayBooking(
      superAdminId,
      adminId
    );

    // Handle errors from service
    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.message || "Failed to fetch holiday bookings",
      });
    }

    // 🔹 Log activity
    await logActivity(req, PANEL, MODULE, "fetch-all", null, true);

    // 🔹 Extract summary
    const summary = result.summary || {
      totalStudents: 0,
      revenue: 0,
      averagePrice: 0,
      topSource: null
    };

    // 🔹 Respond with all metrics
    return res.status(200).json({
      success: true,
      message: "Holiday bookings fetched successfully",
      summary: summary,
      data: result.data,
    });

  } catch (error) {
    if (DEBUG)
      console.error("❌ Error in getAllHolidayBooking:", error);

    return res.status(500).json({
      success: false,
      message: DEBUG ? error.message : "Internal server error",
    });
  }
};

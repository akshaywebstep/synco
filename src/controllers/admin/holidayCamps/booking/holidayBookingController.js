const { validateFormData } = require("../../../../utils/validateFormData");
const holidayBookingService = require("../../../../services/admin/holidayCamps/booking/holidayBooking");

const { logActivity } = require("../../../../utils/admin/activityLogger");
const {
  Admin,
} = require("../../../../models");
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
      // "discountId",
      "venueId",
      "paymentPlanId",
      "totalStudents",
    ];

    for (const field of requiredFields) {
      if (!formData[field] || formData[field] === "") {
        return res.status(400).json({
          status: false,
          message: `${field} is required`,
        });
      }
    }

    // ✅ Step 2: Validate nested arrays
    if (!Array.isArray(formData.students) || formData.students.length === 0) {
      return res.status(400).json({
        status: false,
        message: "At least one student is required",
      });
    }

    if (!Array.isArray(formData.parents) || formData.parents.length === 0) {
      return res.status(400).json({
        status: false,
        message: "At least one parent is required",
      });
    }

    if (!formData.emergency) {
      return res.status(400).json({
        status: false,
        message: "Emergency contact details are required",
      });
    }

    // ✅ Step 3: Validate student fields
    for (const [index, student] of formData.students.entries()) {
      const requiredStudentFields = ["studentFirstName", "studentLastName", "dateOfBirth", "medicalInformation"];

      for (const field of requiredStudentFields) {
        if (!student[field] || student[field].toString().trim() === "") {
          return res.status(400).json({
            status: false,
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
            status: false,
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
          status: false,
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
            status: false,
            message: `Payment ${field} is required`,
          });
        }
      }
    }

    // ✅ Step 5: Create booking via service
    const result = await holidayBookingService.createHolidayBooking(formData, adminId);

    if (!result.success) {
      return res.status(400).json({
        status: false,
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
      status: true,
      message: "Holiday Booking created successfully",
      data: result,
    });
  } catch (error) {
    if (DEBUG) console.error("❌ Error in createHolidayBooking Booking:", error);

    return res.status(500).json({
      status: false,
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
        status: false,
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
    if (!result.status) {
      return res.status(400).json({
        status: false,
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
      status: true,
      message: "Holiday bookings fetched successfully",
      summary: summary,
      data: result.data,
    });

  } catch (error) {
    if (DEBUG)
      console.error("❌ Error in getAllHolidayBooking:", error);

    return res.status(500).json({
      status: false,
      message: DEBUG ? error.message : "Internal server error",
    });
  }
};

exports.cancelHolidayBookingById = async (req, res) => {
  try {
    const adminId = req.admin?.id || null;
    const bookingId = req.params.id;
    const formData = req.body;   // { cancelReason, additionalNotes (optional) }

    if (DEBUG) {
      console.log("📥 Cancel Booking Payload:", JSON.stringify(formData, null, 2));
      console.log("📥 Booking ID:", bookingId);
    }

    // -------------------------------------------
    // ✅ Validate bookingId
    // -------------------------------------------
    if (!bookingId) {
      return res.status(400).json({
        status: false,
        message: "Booking ID is required",
      });
    }

    // -------------------------------------------
    // ✅ Validate cancelReason (mandatory)
    // -------------------------------------------
    if (!formData.cancelReason || formData.cancelReason.trim() === "") {
      return res.status(400).json({
        status: false,
        message: "cancelReason is required",
      });
    }

    // -------------------------------------------
    // ✅ Call service
    // -------------------------------------------
    const result = await holidayBookingService.cancelHolidayBookingById(
      bookingId,
      {
        cancelReason: formData.cancelReason,
        additionalNotes: formData.additionalNotes || null,
      },
      adminId
    );

    if (!result.success) {
      return res.status(400).json({
        status: false,
        message: result.message || "Failed to cancel booking",
      });
    }

    // -------------------------------------------
    // ✅ Log activity
    // -------------------------------------------
    await logActivity(
      req,
      PANEL,
      MODULE,
      "cancel",
      {
        bookingId,
        cancelReason: formData.cancelReason,
        additionalNotes: formData.additionalNotes || "",
      },
      true
    );

    // -------------------------------------------
    // ✅ Send notification
    // -------------------------------------------
    await createNotification(
      req,
      "Holiday Booking Cancelled",
      `Booking ID ${bookingId} was cancelled by ${req?.admin?.firstName || "Admin"} ${req?.admin?.lastName || ""
      }.`,
      "System"
    );

    // -------------------------------------------
    // ✅ Send response
    // -------------------------------------------
    return res.status(200).json({
      status: true,
      message: "Holiday Booking cancelled successfully",
      data: result,
    });
  } catch (error) {
    console.error("❌ Error in cancelHolidayBookingById:", error);

    return res.status(500).json({
      status: false,
      message: DEBUG ? error.message : "Internal server error",
    });
  }
};

exports.sendEmail = async (req, res) => {
  const { bookingIds } = req.body;

  if (!Array.isArray(bookingIds) || bookingIds.length === 0) {
    return res.status(400).json({
      status: false,
      message: "bookingIds (array) is required",
    });
  }

  try {
    const results = await Promise.all(
      bookingIds.map(async (bookingId) => {
        const result =
          await holidayBookingService.sendEmailToParents({
            bookingId,
          });

        await logActivity(
          req,
          PANEL,
          MODULE,
          "send",
          {
            message: `Email attempt for bookingId ${bookingId}: ${result.message}`,
          },
          result.status
        );

        return { bookingId, ...result };
      })
    );

    const allSentTo = results.flatMap((r) => r.sentTo || []);

    return res.status(200).json({
      status: true,
      message: `Emails processed for ${bookingIds.length} bookings`,
      results,
      sentTo: allSentTo,
    });
  } catch (error) {
    console.error("❌ Controller Send Email Error:", error);
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

exports.getHolidayBookingById = async (req, res) => {
  const adminId = req.admin?.id;
  const bookingId = req.params.bookingId;

  try {
    // -----------------------------
    // Validate Admin
    // -----------------------------
    if (!adminId) {
      return res.status(401).json({
        status: false,
        message: "Unauthorized: Admin ID not found.",
      });
    }

    // -----------------------------
    // Validate bookingId
    // -----------------------------
    if (!bookingId || isNaN(Number(bookingId))) {
      return res.status(400).json({
        status: false,
        message: "Invalid bookingId.",
      });
    }

    // -----------------------------
    // Get super admin for access control
    // -----------------------------
    const mainSuperAdminResult = await getMainSuperAdminOfAdmin(adminId);
    const superAdminId = mainSuperAdminResult?.superAdmin?.id ?? null;

    // -----------------------------
    // Call service
    // -----------------------------
    const result = await holidayBookingService.getBookingById(
      bookingId,
      superAdminId,
      adminId
    );

    if (!result.success) {
      return res.status(404).json({
        status: false,
        message: result.message || "Booking not found",
      });
    }

    // -----------------------------
    // Log activity
    // -----------------------------
    await logActivity(req, PANEL, MODULE, "fetch-one", { bookingId }, true);

    // -----------------------------
    // Success response
    // -----------------------------
    return res.status(200).json({
      status: true,
      message: "Holiday booking fetched successfully",
      data: result.data,
      summary: result.summary,
    });

  } catch (error) {
    if (DEBUG) console.error("❌ Error in getHolidayBookingById:", error);

    return res.status(500).json({
      status: false,
      message: DEBUG ? error.message : "Internal server error",
    });
  }
};

exports.updateHolidayBooking = async (req, res) => {
  try {
    const adminId = req.admin?.id;
    const bookingId = req.params.bookingId;
    const formData = req.body;

    if (!bookingId) {
      return res.status(400).json({ status: false, message: "bookingId parameter is required" });
    }

    if (!adminId) {
      return res.status(401).json({ status: false, message: "Unauthorized: Admin ID missing" });
    }

    // ------------------------------------------------------------
    // 🔎 Step 1: Validate Students (ONLY for new students)
    // ------------------------------------------------------------
    if (Array.isArray(formData.students)) {
      for (const [index, student] of formData.students.entries()) {

        const requiredFields = ["studentFirstName", "studentLastName", "dateOfBirth", "medicalInformation"];

        for (const field of requiredFields) {
          if (student[field] === "") {
            return res.status(400).json({
              status: false,
              message: `Student ${index + 1} ${field} cannot be empty`
            });
          }
        }

        // Validate NEW students additional
        if (!student.id) {
          for (const field of requiredFields) {
            if (!student[field] || student[field].toString().trim() === "") {
              return res.status(400).json({
                status: false,
                message: `New Student ${index + 1} ${field} is required`
              });
            }
          }
        }
      }
    }

    // ------------------------------------------------------------
    // 🔎 Step 2: Validate Parents (ONLY for new parents)
    // ------------------------------------------------------------
    if (Array.isArray(formData.parents)) {
      for (const [index, parent] of formData.parents.entries()) {

        const requiredFields = [
          "parentFirstName",
          "parentLastName",
          "parentEmail",
          "parentPhoneNumber",
          "relationToChild",
          "howDidYouHear"
        ];

        for (const field of requiredFields) {
          if (parent[field] === "") {
            return res.status(400).json({
              status: false,
              message: `Parent ${index + 1} ${field} cannot be empty`
            });
          }
        }

        // New only
        if (!parent.id) {
          for (const field of requiredFields) {
            if (!parent[field] || parent[field].trim() === "") {
              return res.status(400).json({
                status: false,
                message: `New Parent ${index + 1} ${field} is required`
              });
            }
          }
        }
      }
    }

    // ------------------------------------------------------------
    // 🔎 Step 3: Validate Emergency Contacts (ONLY new ones)
    // ------------------------------------------------------------
    if (Array.isArray(formData.emergencyContacts)) {
      for (const [index, emergency] of formData.emergencyContacts.entries()) {

        const requiredFields = [
          "emergencyFirstName",
          "emergencyLastName",
          "emergencyPhoneNumber",
          "emergencyRelation"
        ];

        for (const field of requiredFields) {
          if (emergency[field] === "") {
            return res.status(400).json({
              status: false,
              message: `Emergency Contact ${index + 1} ${field} cannot be empty`
            });
          }
        }

        // New only
        if (!emergency.id) {
          for (const field of requiredFields) {
            if (!emergency[field] || emergency[field].trim() === "") {
              return res.status(400).json({
                status: false,
                message: `New Emergency Contact ${index + 1} ${field} is required`
              });
            }
          }
        }
      }
    }

    // ------------------------------------------------------------
    // ⚙️ Step 4: Call Update Service
    // ------------------------------------------------------------
    const result = await holidayBookingService.updateHolidayBookingById(
      bookingId,
      formData,
      adminId
    );

    // ------------------------------------------------------------
    // 📝 Step 5: Activity Log & Notification
    // ------------------------------------------------------------
    await logActivity(req, PANEL, MODULE, "update", formData, true);

    await createNotification(
      req,
      "Holiday Booking Updated Successfully",
      `Booking updated by ${req.admin?.firstName || "Admin"} ${req.admin?.lastName || ""}.`,
      "System"
    );

    // ------------------------------------------------------------
    // 📤 Step 6: Response
    // ------------------------------------------------------------
    return res.status(200).json({
      status: true,
      message: "Holiday Booking updated successfully",
      data: result.details
    });

  } catch (error) {
    console.error("❌ updateHolidayBooking Error:", error);
    return res.status(500).json({
      status: false,
      message: DEBUG ? error.message : "Internal server error"
    });
  }
};

exports.waitingListCreate = async (req, res) => {
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
      "venueId",
      "classScheduleId",
      "totalStudents",
    ];

    for (const field of requiredFields) {
      if (!formData[field] || formData[field] === "") {
        return res.status(400).json({
          status: false,
          message: `${field} is required`,
        });
      }
    }

    // ✅ Step 2: Validate nested arrays
    if (!Array.isArray(formData.students) || formData.students.length === 0) {
      return res.status(400).json({
        status: false,
        message: "At least one student is required",
      });
    }

    if (!Array.isArray(formData.parents) || formData.parents.length === 0) {
      return res.status(400).json({
        status: false,
        message: "At least one parent is required",
      });
    }

    if (!formData.emergency) {
      return res.status(400).json({
        status: false,
        message: "Emergency contact details are required",
      });
    }

    // ✅ Step 3: Validate student fields
    for (const [index, student] of formData.students.entries()) {
      const requiredStudentFields = ["studentFirstName", "studentLastName", "dateOfBirth", "medicalInformation"];

      for (const field of requiredStudentFields) {
        if (!student[field] || student[field].toString().trim() === "") {
          return res.status(400).json({
            status: false,
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
            status: false,
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
          status: false,
          message: `Emergency ${field} is required`,
        });
      }
    }

    // ✅ Step 5: Create booking via service
    const result = await holidayBookingService.waitingListCreate(formData, adminId);

    if (!result.success) {
      return res.status(400).json({
        status: false,
        message: result.message || "Failed to create booking",
      });
    }

    if (DEBUG) console.log("✅ Holiday Waiting List Booking created successfully:", result);

    // ✅ Step 6: Log and notify
    await logActivity(req, PANEL, MODULE, "create", formData.data, true);
    await createNotification(
      req,
      "Holiday Waiting List Booking Created Successfully",
      `The booking was created by ${req?.admin?.firstName || "Admin"} ${req?.admin?.lastName || ""
      }.`,
      "System"
    );

    // ✅ Step 7: Response
    return res.status(201).json({
      status: true,
      message: "Holiday Waiting List Booking created successfully",
      data: result,
    });
  } catch (error) {
    if (DEBUG) console.error("❌ Error in waitingListCreate Booking:", error);

    return res.status(500).json({
      status: false,
      message: DEBUG ? error.message : "Internal server error",
    });
  }
};

exports.getHolidayCampsReports = async (req, res) => {
  const adminId = req.admin?.id;
  const { filterType = "thisMonth" } = req.query;
  try {
    // Validate admin
    // Validate admin
    if (!adminId) {
      return res.status(401).json({
        status: false,
        message: "Unauthorized: Admin ID not found.",
      });
    }

    // 🔹 Identify super admin
    const mainSuperAdminResult = await getMainSuperAdminOfAdmin(adminId);
    const superAdminId = mainSuperAdminResult?.superAdmin?.id ?? null;

    // ---- Call the Service ----
    const report = await holidayBookingService.holidayCampsReports(
      superAdminId,
      adminId,
      filterType
    );

    if (!report.success) {
      return res.status(400).json({
        status: false,
        message: report.message,
      });
    }

    return res.status(200).json({
      status: true,
      message: "Holiday camp reports fetched successfully.",
      data: report.data,
    });

  } catch (error) {
    console.error("❌ Error fetching holiday camps report:", error);

    return res.status(500).json({
      status: false,
      message: "Internal server error.",
      error: error.message,
    });
  }
};

// ✅ Get All Discounts
exports.getAllDiscounts = async (req, res) => {
  if (DEBUG) console.log("📋 [Step 1] Request received to fetch all discounts");

  try {
    const result = await holidayBookingService.getAllDiscounts();

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
    const message = `Fetched ${count} discount${
      count === 1 ? "" : "s"
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

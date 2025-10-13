const { validateFormData } = require("../../../utils/validateFormData");
const BookingMembershipService = require("../../../services/admin/booking/bookingMembership");
const { logActivity } = require("../../../utils/admin/activityLogger");

const {
  sequelize,
  Venue,
  ClassSchedule,
  BookingParentMeta,
  BookingStudentMeta,
  Booking,
  BookingEmergencyMeta,
} = require("../../../models");
const bookingService = require("../../../services/admin/booking/bookingMembership");

// const { sequelize, Booking, BookingStudentMeta,
//   BookingParentMeta,
//   BookingEmergencyMeta, } = require("../../../models"); 
const emailModel = require("../../../services/email");
const sendEmail = require("../../../utils/email/sendEmail");
const {
  createNotification,
} = require("../../../utils/admin/notificationHelper");
const PaymentPlan = require("../../../services/admin/payment/paymentPlan");

const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "book-paid-trial";

// Controller: Create Booking (Paid )
exports.createBooking = async (req, res) => {
  const formData = req.body;
  let paymentPlan;
  try {
    // ✅ Check class
    const classData = await ClassSchedule.findByPk(formData.classScheduleId);
    if (!classData)
      return res
        .status(404)
        .json({ status: false, message: "Class not found." });

    // ✅ Check capacity
    if (classData.capacity < formData.totalStudents) {
      return res.status(400).json({
        status: false,
        message: `Only ${classData.capacity} slot(s) left for this class.`,
      });
    }

    // ✅ Validate form
    const { isValid, error } = validateFormData(formData, {
      requiredFields: ["startDate", "totalStudents", "classScheduleId"],
    });
    if (!isValid) {
      await logActivity(req, PANEL, MODULE, "create", error, false);
      return res.status(400).json({ status: false, ...error });
    }

    if (!Array.isArray(formData.students) || formData.students.length === 0) {
      return res
        .status(400)
        .json({ status: false, message: "At least one student is required." });
    }

    // ✅ Inject venue
    formData.venueId = classData.venueId;
    let skipped = [];
    // 🔹 Attach payment gateway response so the service can save it
    // if (formData.paymentPlanId) {

    //   const planCheck = await PaymentPlan.getPlanById(paymentPlanId, createdBy); // ✅ add createdBy here
    const paymentPlanId = formData.paymentPlanId; // ✅ define it first
    if (paymentPlanId) {

      const planCheck = await PaymentPlan.getPlanById(paymentPlanId, req.admin?.id);
      if (!planCheck.status) {
        skipped.push({ paymentPlanId, reason: "Plan does not exist" });
        if (DEBUG) {
          console.log(`⛔ Skipped plan ID ${paymentPlanId}: Not found`);
          console.log("🔍 Fetching payment plan:", paymentPlanId, "createdBy:", req.admin?.id);
        }
        return res
          .status(400)
          .json({ status: false, message: planCheck.message });
      }

      paymentPlan = planCheck.data;

      let incomingGatewayResponse =
        formData.paymentResponse || formData.gatewayResponse || null;

      if (
        incomingGatewayResponse &&
        typeof incomingGatewayResponse === "string"
      ) {
        try {
          incomingGatewayResponse = JSON.parse(incomingGatewayResponse);
        } catch (_) { }
      }

      formData.paymentResponse = incomingGatewayResponse || null;
      formData.gatewayResponse = incomingGatewayResponse || null;
    }

    const leadId = req.params.leadId || null;
    if (leadId) {
      const existingBooking = await Booking.findOne({ where: { leadId } });
      if (existingBooking) {
        return res.status(400).json({
          status: false,
          message: "You already have a booking linked to this lead.",
        });
      }
    }
    // 🔹 Step 1: Create Booking + Students + Parents (Service)
    const result = await BookingMembershipService.createBooking(formData, {
      source: req.source,
      adminId: req.admin?.id || null,
      leadId,
    });
    if (!result.status) {
      await logActivity(req, PANEL, MODULE, "create", result, false);
      return res.status(500).json({ status: false, message: result.message });
    }

    const booking = result.data.booking;
    const studentIds = result.data.studentIds || [result.data.studentId]; // support multiple students

    // 🔹 Step 2: Fetch venue for email
    const venue = await Venue.findByPk(classData.venueId);
    const venueName = venue?.venueName || venue?.name || "N/A";

    let paymentPlanType;

    if (paymentPlan.interval.toLowerCase() === "month") {
      if (parseInt(paymentPlan.duration, 10) === 1) {
        paymentPlanType = '1-month';
      } else if (parseInt(paymentPlan.duration, 10) === 6) {
        paymentPlanType = '6-month';
      } else if (parseInt(paymentPlan.duration, 10) === 12) {
        paymentPlanType = '12-month';
      }
    } else if (paymentPlan.interval.toLowerCase() === "quarter") {
      if (parseInt(paymentPlan.duration, 10) === 1) {
        paymentPlanType = '1-quarter';
      } else if (parseInt(paymentPlan.duration, 10) === 6) {
        paymentPlanType = '6-quarter';
      } else if (parseInt(paymentPlan.duration, 10) === 12) {
        paymentPlanType = '12-quarter';
      }
    } else if (paymentPlan.interval.toLowerCase() === "year") {
      if (parseInt(paymentPlan.duration, 10) === 1) {
        paymentPlanType = '1-year';
      } else if (parseInt(paymentPlan.duration, 10) === 6) {
        paymentPlanType = '6-year';
      } else if (parseInt(paymentPlan.duration, 10) === 12) {
        paymentPlanType = '12-year';
      }
    }

    if (paymentPlanType) {
      // 🔹 Step 3: Fetch email template (book-paid-trial)
      const {
        status: configStatus,
        emailConfig,
        htmlTemplate,
        subject,
      } = await emailModel.getEmailConfig(PANEL, "book-paid-trial"); // matches your DB entry

      if (configStatus && htmlTemplate) {
        // ✅ Loop through all students
        for (const sId of studentIds) {
          const parentMetas = await BookingParentMeta.findAll({
            where: { studentId: sId },
          });
          if (!parentMetas.length) continue;

          // Loop over parents and send emails
          for (const p of parentMetas) {
            try {
              const student =
                result.data.students?.find((st) => st.id === sId) || {};
              let htmlBody = htmlTemplate
                .replace(
                  /{{parentName}}/g,
                  `${p.parentFirstName} ${p.parentLastName}`
                )
                .replace(/{{studentFirstName}}/g, student.studentFirstName || "")
                .replace(/{{studentLastName}}/g, student.studentLastName || "")
                .replace(
                  /{{studentName}}/g,
                  `${student.studentFirstName || ""} ${student.studentLastName || ""
                  }`
                )
                .replace(/{{venueName}}/g, venueName)
                .replace(/{{className}}/g, classData.className || "N/A")
                .replace(
                  /{{classTime}}/g,
                  `${classData.startTime} - ${classData.endTime}`
                )
                .replace(/{{startDate}}/g, booking?.startDate || "")
                .replace(/{{parentEmail}}/g, p.parentEmail || "")
                .replace(/{{parentPassword}}/g, "Synco123") // ✅ this is correct
                .replace(/{{appName}}/g, "Synco")
                .replace(/{{year}}/g, new Date().getFullYear().toString())
                .replace(
                  /{{logoUrl}}/g,
                  "https://webstepdev.com/demo/syncoUploads/syncoLogo.png"
                )
                .replace(
                  /{{kidsPlaying}}/g,
                  "https://webstepdev.com/demo/syncoUploads/kidsPlaying.png"
                );

              await sendEmail(emailConfig, {
                recipient: [
                  {
                    name: `${p.parentFirstName} ${p.parentLastName}`,
                    email: p.parentEmail,
                  },
                ],
                subject,
                htmlBody,
              });
            } catch (err) {
              console.error(
                `❌ Failed to send email to ${p.parentEmail}:`,
                err.message
              );
            }
          }
        }
      }
    }

    // 🔹 Step 4: Notifications & Logging
    await createNotification(
      req,
      "New Booking Created",
      `Booking "${classData.className}" scheduled on ${formData.startDate}`,
      "System"
    );
    await logActivity(req, PANEL, MODULE, "create", result, true);

    return res.status(201).json({
      status: true,
      message: "Booking created successfully. Confirmation email sent.",
      data: booking,
    });
  } catch (error) {
    await logActivity(
      req,
      PANEL,
      MODULE,
      "create",
      { error: error.message },
      false
    );
    return res.status(500).json({ status: false, message: "Server error." });
  }
};

exports.getAllPaidBookings = async (req, res) => {
  try {
    const filters = {
      status: req.query.status,
      venueId: req.query.venueId,
      venueName: req.query.venueName,
      dateBooked: req.query.dateBooked,
      studentName: req.query.studentName,
      dateFrom: req.query.dateFrom ? req.query.dateFrom : undefined,
      dateTo: req.query.dateTo ? req.query.dateTo : undefined,
      bookedBy: req.query.bookedBy,
      duration: req.query.duration
        ? parseInt(req.query.duration, 10)
        : undefined, // ✅ added
      duration: req.query.duration
        ? parseInt(req.query.duration, 10)
        : undefined,
      fromDate: req.query.fromDate ? req.query.fromDate : undefined, // ✅ added
      toDate: req.query.toDate ? req.query.toDate : undefined, // ✅ added
    };

    const result = await BookingMembershipService.getAllBookingsWithStats(
      filters
    );

    if (!result.status) {
      return res.status(500).json({ status: false, message: result.message });
    }

    await logActivity(req, PANEL, MODULE, "read", { filters }, true);

    return res.status(200).json({
      status: true,
      message: "Paid bookings retrieved successfully",
      data: result.data,
      stats: result.stats,
    });
  } catch (error) {
    await logActivity(
      req,
      PANEL,
      MODULE,
      "read",
      { error: error.message },
      false
    );
    return res.status(500).json({ status: false, message: "Server error" });
  }
};

exports.sendSelectedMemberEmail = async (req, res) => {
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
          await BookingMembershipService.sendActiveMemberSaleEmailToParents({
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

exports.getAllPaidActiveBookings = async (req, res) => {
  try {
    console.log("🔹 Controller start: getAllPaidActiveBookings");

    // Step 1: Prepare filters
    const filters = {
      status: req.query.status,
      venueId: req.query.venueId,
      venueName: req.query.venueName,
      dateBooked: req.query.dateBooked,
      studentName: req.query.studentName,
      planType: req.query.planType,
      // lifeCycle: req.query.lifeCycle,
      // flexiPlan: req.query.flexiPlan,
      bookedBy: req.query.bookedBy,
      dateFrom: req.query.dateFrom ? req.query.dateFrom : undefined,
      dateTo: req.query.dateTo ? req.query.dateTo : undefined,
      fromDate: req.query.fromDate ? req.query.fromDate : undefined, // ✅ added
      toDate: req.query.toDate ? req.query.toDate : undefined, // ✅ added
    };
    console.log("🔹 Filters prepared:", filters);

    // Step 2: Call service
    const result = await BookingMembershipService.getActiveMembershipBookings(
      filters
    );
    console.log("🔹 Service result received:", result);

    // Step 3: Check result status
    if (!result.status) {
      console.error("❌ Service failed:", result.message);
      return res.status(500).json({ status: false, message: result.message });
    }

    // Step 4: Log activity
    await logActivity(req, PANEL, MODULE, "read", { filters }, true);
    console.log("🔹 Activity logged successfully");

    // Step 5: Return response
    console.log("🔹 Returning response with data count:", result.data.length);
    return res.status(200).json({
      status: true,
      message: "Paid bookings retrieved successfully",
      data: result.data,
      stats: result.stats,
    });
  } catch (error) {
    console.error("❌ Controller error:", error.message);
    await logActivity(
      req,
      PANEL,
      MODULE,
      "read",
      { error: error.message },
      false
    );
    return res.status(500).json({ status: false, message: "Server error" });
  }
};

exports.sendActiveSelectedMemberEmail = async (req, res) => {
  const { bookingIds } = req.body;

  if (!bookingIds || !Array.isArray(bookingIds) || bookingIds.length === 0) {
    return res.status(400).json({
      status: false,
      message: "bookingIds (array) is required",
    });
  }

  if (DEBUG) {
    console.log("📨 Sending Emails for bookingIds:", bookingIds);
  }

  try {
    const allSentTo = [];

    for (const bookingId of bookingIds) {
      // Call service for each bookingId
      const result =
        await BookingMembershipService.sendActiveMemberSaleEmailToParents({
          bookingId,
        });

      if (!result.status) {
        await logActivity(req, PANEL, MODULE, "send", result, false);
        return res.status(500).json({
          status: false,
          message: result.message,
          error: result.error,
        });
      }

      allSentTo.push(...result.sentTo);

      await logActivity(
        req,
        PANEL,
        MODULE,
        "send",
        {
          message: `Email sent for bookingId ${bookingId}`,
        },
        true
      );
    }

    return res.status(200).json({
      status: true,
      message: `Emails sent for ${bookingIds.length} bookings`,
      sentTo: allSentTo, // combined array of all parent emails
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

exports.transferClass = async (req, res) => {
  const formData = req.body;

  try {
    if (!formData.bookingId || !formData.classScheduleId) {
      return res.status(400).json({
        status: false,
        message: "Booking ID and new class schedule are required.",
      });
    }

    const classData = await ClassSchedule.findByPk(formData.classScheduleId);
    if (!classData) {
      return res
        .status(404)
        .json({ status: false, message: "New class not found." });
    }

    if (classData.capacity <= 0) {
      return res.status(400).json({
        status: false,
        message: `No slots left in the new class "${classData.className}".`,
      });
    }

    // ✅ If venue not passed, take from class
    if (!formData.venueId) {
      formData.venueId = classData.venueId;
    }

    // 🔹 Call Service
    const result = await BookingMembershipService.transferClass(formData, {
      adminId: req.admin?.id || null,
    });

    if (!result.status) {
      await logActivity(req, PANEL, MODULE, "transfer", result, false);
      return res.status(500).json({ status: false, message: result.message });
    }

    const venue = await Venue.findByPk(formData.venueId);
    const venueName = venue?.venueName || venue?.name || "N/A";

    await createNotification(
      req,
      "Booking Transferred",
      `Booking transferred to class "${classData.className}" at venue "${venueName}"`,
      "System"
    );

    await logActivity(req, PANEL, MODULE, "transfer", result, true);

    return res.status(200).json({
      status: true,
      message: "Class transferred successfully.",
      data: result.data,
    });
  } catch (error) {
    await logActivity(
      req,
      PANEL,
      MODULE,
      "transfer",
      { error: error.message },
      false
    );
    return res.status(500).json({ status: false, message: "Server error." });
  }
};

exports.addToWaitingList = async (req, res) => {
  const t = await require("../../../models").sequelize.transaction();
  try {
    console.log("🚀 [Controller] addToWaitingList started");

    const adminId = req.admin?.id;
    const data = req.body;

    if (!adminId) {
      await t.rollback();
      console.warn("⚠️ [Controller] Admin not found in request");
      return res
        .status(400)
        .json({ status: false, message: "Admin is required.", data: null });
    }
    console.log("✅ [Controller] Admin validated:", adminId);

    // ✅ Call service to create waiting list booking
    console.log("🔍 [Controller] Calling service addToWaitingListService");
    const result = await BookingMembershipService.addToWaitingListService(
      data,
      adminId
    );

    if (!result.status) {
      await t.rollback();
      console.warn("⚠️ [Controller] Service failed:", result.message);
      return res.status(400).json(result);
    }

    const waitingBooking = result.data;
    console.log("✅ [Controller] Service returned success:", waitingBooking.id);

    // ✅ Create notification
    console.log("🔔 [Controller] Creating notification");
    await createNotification(
      req,
      "Booking Added to Waiting List",
      `Booking "${waitingBooking.bookingId}" added to waiting list for class ID: ${waitingBooking.classScheduleId}`,
      "System",
      t
    );

    // ✅ Log activity
    console.log("📝 [Controller] Logging activity");
    await logActivity(
      req,
      PANEL,
      MODULE,
      "add_to_waiting_list",
      waitingBooking,
      true,
      t
    );

    console.log("✅ [Controller] Notification & log created");

    await t.commit();
    console.log("🎉 [Controller] Transaction committed successfully");

    return res.status(201).json(result);
  } catch (error) {
    await t.rollback();
    console.error("❌ [Controller] addToWaitingList error:", error);
    return res.status(500).json({
      status: false,
      message: "Server error.",
      data: null,
    });
  }
};

exports.getWaitingList = async (req, res) => {
  try {
    const result = await BookingMembershipService.getWaitingList();

    if (!result.status) {
      return res.status(500).json({ status: false, message: result.message });
    }

    return res.status(200).json({
      status: true,
      message: "Waiting list fetched successfully",
      data: result.data,
    });
  } catch (error) {
    console.error("❌ getWaitingList controller error:", error);
    return res.status(500).json({ status: false, message: "Server error" });
  }
};

exports.getBookingsById = async (req, res) => {
  try {
    const { bookingId } = req.params; // ✅ get bookingId from URL params
    const result = await BookingMembershipService.getBookingsById(bookingId);

    if (!result.status) {
      return res.status(500).json({ status: false, message: result.message });
    }

    await logActivity(req, PANEL, MODULE, "read", {}, true);

    return res.status(200).json({
      status: true,
      message: "Paid booking retrieved successfully",
      data: result.data,
      totalPaidBookings: result.totalPaidBookings,
    });
  } catch (error) {
    await logActivity(
      req,
      PANEL,
      MODULE,
      "read",
      { error: error.message },
      false
    );

    return res.status(500).json({
      status: false,
      message: "Server error",
    });
  }
};

// exports.updateBooking = async (req, res) => {
//   const { bookingId } = req.params;
//   const formData = req.body;

//   console.log("🚀 Received bookingId:", bookingId);
//   console.log("🚀 Form data:", formData);

//   try {
//     // Step 0: Fetch existing booking
//     const bookingRes = await BookingMembershipService.getBookingsById(bookingId);
//     if (!bookingRes.status) {
//       console.error("❌ Booking not found:", bookingRes.message);
//       return res.status(404).json({ status: false, message: bookingRes.message });
//     }
//     const existingBooking = bookingRes.data;
//     console.log("✅ Existing booking:", existingBooking);

//     // Step 2: Validate form
//     const { isValid, error } = validateFormData(formData, {
//       requiredFields: [],
//     });
//     if (!isValid) {
//       console.error("❌ Form validation failed:", error);
//       await logActivity(req, "PANEL", "BOOKING", "update", error, false);
//       return res.status(400).json({ status: false, ...error });
//     }

//     if (!Array.isArray(formData.students) || formData.students.length === 0) {
//       return res.status(400).json({ status: false, message: "At least one student is required." });
//     }

//     formData.bookingId = bookingId;

//     // Step 3: Update booking using service
//     const result = await BookingMembershipService.updateBooking(formData, {
//       adminId: req.admin?.id || null,
//     });

//     if (!result.status) {
//       console.error("❌ Booking update failed:", result.message);
//       await logActivity(req, "PANEL", "BOOKING", "update", result, false);
//       return res.status(500).json({ status: false, message: result.message });
//     }

//     // Step 4: Prepare response
//     const responseData = {
//       booking: bookingId,
//       students: formData.students,
//       parents: formData.parents || [],
//       emergency: formData.emergency || null,
//     };

//     console.log("✅ Booking updated successfully:", responseData);
//     await logActivity(req, "PANEL", "BOOKING", "update", result, true);

//     return res.status(200).json({
//       status: true,
//       message: "Booking updated successfully. Confirmation email sent.",
//       data: responseData,
//     });
//   } catch (error) {
//     console.error("❌ Server error:", error);
//     await logActivity(req, "PANEL", "BOOKING", "update", { error: error.message }, false);
//     return res.status(500).json({ status: false, message: "Server error." });
//   }
// };

exports.updateBooking = async (req, res) => {
  if (DEBUG) console.log("🔹 Step 0: Controller entered");

  const bookingId = req.params?.bookingId;
  const studentsPayload = req.body?.students || [];
  const adminId = req.admin?.id;

  // ✅ Security check
  if (!adminId) {
    if (DEBUG) console.warn("❌ Unauthorized access attempt");
    return res.status(401).json({ status: false, message: "Unauthorized" });
  }

  if (!bookingId) {
    if (DEBUG) console.warn("❌ Booking ID missing in URL");
    return res.status(400).json({
      status: false,
      message: "Booking ID is required in URL (params.bookingId).",
    });
  }

  const t = await sequelize.transaction();

  try {
    if (DEBUG) console.log("🔹 Step 1: Calling service to update booking + students");

    // Call service
    const updateResult = await bookingService.updateBookingWithStudents(
      bookingId,
      studentsPayload,
      t
    );

    await t.commit();
    if (DEBUG) console.log("✅ Step 2: Transaction committed successfully");

    // Log activity
    if (DEBUG) console.log("🔹 Step 3: Logging activity");
    await logActivity(
      req,
      "admin",
      "book-membership",
      "update",
      { message: `Updated student, parent, and emergency data for booking ID: ${bookingId}` },
      true
    );

    // Create notification
    if (DEBUG) console.log("🔹 Step 4: Creating notification");
    await createNotification(
      req,
      "Booking Updated",
      `Student, parent, and emergency data updated for booking ID: ${bookingId}.`,
      "System"
    );

    if (DEBUG) console.log("✅ Step 5: Controller finished successfully");

    return res.status(200).json({
      status: updateResult.status,
      message: updateResult.message,
      data: updateResult.data || null,
    });

  } catch (error) {
    if (!t.finished) await t.rollback();
    if (DEBUG) console.error("❌ updateBooking Error:", error.message);
    return res.status(500).json({
      status: false,
      message: error.message || "Failed to update booking",
    });
  }
};

exports.retryBookingPayment = async (req, res) => {
  console.log("🔹 [Controller] Retry booking payment request received");
  const { bookingId } = req.params;
  console.log(
    "🔎 bookingId from req.params:",
    bookingId,
    "type:",
    typeof bookingId
  );
  const formData = req.body;

  try {
    console.log("🔹 [Controller] Looking up booking:", bookingId);
    const booking = await Booking.findByPk(bookingId);
    if (!booking) {
      console.log("❌ [Controller] Booking not found");
      return res
        .status(404)
        .json({ status: false, message: "Booking not found." });
    }
    console.log("✅ [Controller] Booking found:", booking.id);

    console.log("🔹 [Controller] Validating form data...");
    const { isValid, error } = validateFormData(formData, {
      requiredFields: ["payment"],
    });
    if (!isValid) {
      console.log("❌ [Controller] Validation failed:", error);
      await logActivity(req, PANEL, MODULE, "retry", error, false);
      return res.status(400).json({ status: false, ...error });
    }
    console.log("✅ [Controller] Validation passed");

    console.log("🔹 [Controller] Calling service retryBookingPayment...");
    const result = await BookingMembershipService.retryBookingPayment(
      bookingId,
      formData
    );
    console.log("✅ [Controller] Service response:", result);

    if (!result.status) {
      console.log("❌ [Controller] Retry failed:", result.message);
      await logActivity(req, PANEL, MODULE, "retry", result, false);
      return res.status(400).json({ status: false, message: result.message });
    }

    console.log("🔹 [Controller] Fetching class & venue details...");
    const classData = await ClassSchedule.findByPk(booking.classScheduleId);
    const venue = await Venue.findByPk(booking.venueId);
    const venueName = venue?.venueName || venue?.name || "N/A";
    console.log("✅ [Controller] Class & venue loaded");

    if (result.paymentStatus === "paid") {
      console.log(
        "🔹 [Controller] Payment successful, sending confirmation emails..."
      );
      const {
        status: configStatus,
        emailConfig,
        htmlTemplate,
        subject,
      } = await emailModel.getEmailConfig(PANEL, "book-paid-trial");

      if (configStatus && htmlTemplate) {
        const studentId = result.studentId || booking.studentId; // 👈 FIX
        if (!studentId) {
          console.warn("⚠️ No studentId found, skipping parent email sending.");
        } else {
          const parentMetas = await BookingParentMeta.findAll({
            where: { studentId },
          });
          console.log("✅ [Controller] ParentMetas found:", parentMetas.length);

          for (const p of parentMetas) {
            try {
              let htmlBody = htmlTemplate;
              // ... replace placeholders ...
              console.log("📤 [Controller] Sending email to:", p.parentEmail);
              await sendEmail(emailConfig, {
                recipient: [
                  {
                    name: `${p.parentFirstName} ${p.parentLastName}`,
                    email: p.parentEmail,
                  },
                ],
                subject,
                htmlBody,
              });
              console.log("✅ [Controller] Email sent to:", p.parentEmail);
            } catch (err) {
              console.error(
                `❌ [Controller] Failed to send retry email to ${p.parentEmail}:`,
                err.message
              );
            }
          }
        }
      }
    }

    console.log("🔹 [Controller] Creating notification & logging activity...");
    await createNotification(
      req,
      "Booking Payment Retry",
      `Booking "${classData?.className}" retried with status: ${result.paymentStatus}`,
      "System"
    );
    await logActivity(req, PANEL, MODULE, "retry", result, true);
    console.log("✅ [Controller] Notification & log created");

    return res.status(200).json({
      status: true,
      message: `Booking payment retried successfully. Status: ${result.paymentStatus}`,
      data: result,
    });
  } catch (error) {
    console.error("❌ [Controller] Server error:", error.message);
    await logActivity(
      req,
      PANEL,
      MODULE,
      "retry",
      { error: error.message },
      false
    );
    return res.status(500).json({ status: false, message: "Server error." });
  }
};

exports.listFailedPayments = async (req, res) => {
  const { bookingId } = req.params;

  try {
    const failedPayments =
      await BookingMembershipService.getFailedPaymentsByBookingId(bookingId);

    if (!failedPayments.length) {
      return res.status(404).json({
        status: false,
        message: "No failed payments found for this booking.",
        data: [],
      });
    }

    res.status(200).json({
      status: true,
      message: "Failed payments fetched successfully.",
      data: failedPayments,
    });
  } catch (error) {
    console.error("Error fetching failed payments:", error);
    res.status(500).json({
      status: false,
      message: error.message || "Internal server error",
    });
  }
};

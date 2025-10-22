const { validateFormData } = require("../../../utils/validateFormData");
const BookingTrialService = require("../../../services/admin/booking/bookingTrial");
const { logActivity } = require("../../../utils/admin/activityLogger");
const { Venue, ClassSchedule, Admin } = require("../../../models");
const emailModel = require("../../../services/email");
const sendEmail = require("../../../utils/email/sendEmail");
const { BookingParentMeta, Booking } = require("../../../models");
const { getMainSuperAdminOfAdmin } = require("../../../utils/auth");
const {
  createNotification,
} = require("../../../utils/admin/notificationHelper");
const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "book-free-trial";

// Create Book a Free Trial
exports.createBooking = async (req, res) => {
  if (DEBUG) console.log("📥 Received booking request");
  const formData = req.body;

  // formData.createdBy = req.admin.id;

  if (DEBUG) console.log("🔍 Fetching class data...");
  const classData = await ClassSchedule.findByPk(formData.classScheduleId);
  if (!classData) {
    if (DEBUG) console.warn("❌ Class not found.");
    return res.status(404).json({ status: false, message: "Class not found." });
  }

  if (DEBUG) console.log("📊 Checking class capacity...");
  if (classData.capacity < formData.totalStudents) {
    if (DEBUG) console.warn("⚠️ Not enough capacity in class.");
    return res.status(400).json({
      status: false,
      message: `Only ${classData.capacity} slot(s) left for this class.`,
    });
  }

  if (DEBUG) console.log("✅ Validating form data...");
  const { isValid, error } = validateFormData(formData, {
    requiredFields: [
      "trialDate",
      "totalStudents",
      "classScheduleId",
      "students",
      "parents",
      "emergency",
    ],
  });
  if (!isValid) {
    if (DEBUG) console.warn("❌ Form validation failed:", error);
    const firstKey = Object.keys(error)[0];
    return res.status(400).json({ status: false, message: error[firstKey] });
  }

  if (!Array.isArray(formData.students) || formData.students.length === 0) {
    if (DEBUG) console.warn("❌ No students provided.");
    return res.status(400).json({
      status: false,
      message: "At least one student must be provided.",
    });
  }

  if (DEBUG) console.log("📍 Setting class metadata...");
  formData.venueId = classData.venueId;
  formData.className = classData.className;
  formData.classTime = `${classData.startTime} - ${classData.endTime}`;

  if (DEBUG) console.log("🏫 Fetching venue data...");
  const venue = await Venue.findByPk(formData.venueId);
  if (!venue) {
    const message = "Venue linked to this class is not configured.";
    if (DEBUG) console.warn("❌ Venue not found.");
    await logActivity(req, PANEL, MODULE, "create", { message }, false);
    return res.status(404).json({ status: false, message });
  }

  if (DEBUG) console.log("👨‍👩‍👧 Validating students and parents...");
  const emailMap = new Map();
  const duplicateEmails = [];

  for (const student of formData.students) {
    // ✅ Validate student fields individually
    if (!student.studentFirstName) {
      return res.status(400).json({
        status: false,
        message: "Student first name is required.",
      });
    }
    if (!student.studentLastName) {
      return res.status(400).json({
        status: false,
        message: "Student last name is required.",
      });
    }
    if (!student.dateOfBirth) {
      return res.status(400).json({
        status: false,
        message: "Student date of birth is required.",
      });
    }
    if (!student.medicalInformation) {
      return res.status(400).json({
        status: false,
        message: "Student medical information is required.",
      });
    }

    // ✅ Validate emergency contact
    const emergency = req.body.emergency || {};
    if (!emergency.emergencyFirstName) {
      return res.status(400).json({
        status: false,
        message: "Emergency contact first name is required.",
      });
    }
    if (!emergency.emergencyLastName) {
      return res.status(400).json({
        status: false,
        message: "Emergency contact last name is required.",
      });
    }
    if (!emergency.emergencyPhoneNumber) {
      return res.status(400).json({
        status: false,
        message: "Emergency contact phone number is required.",
      });
    }

    student.className = classData.className;
    student.startTime = classData.startTime;
    student.endTime = classData.endTime;

    // ✅ Use the global parents array (from formData.parents)
    if (!Array.isArray(formData.parents) || formData.parents.length === 0) {
      return res.status(400).json({
        status: false,
        message: "At least one parent must be provided.",
      });
    }

    for (const parent of formData.parents) {
      if (!parent.parentFirstName) {
        return res.status(400).json({
          status: false,
          message: "Parent first name is required.",
        });
      }
      if (!parent.parentLastName) {
        return res.status(400).json({
          status: false,
          message: "Parent last name is required.",
        });
      }
      if (!parent.parentEmail) {
        return res.status(400).json({
          status: false,
          message: "Parent email is required.",
        });
      }
      if (!parent.parentPhoneNumber) {
        return res.status(400).json({
          status: false,
          message: "Parent phone number is required.",
        });
      }

      const email = parent.parentEmail.trim().toLowerCase();
      if (emailMap.has(email)) continue;

      const exists = await Admin.findOne({ where: { email } });
      if (exists) {
        if (DEBUG) console.warn(`⚠️ Duplicate email found: ${email}`);
        duplicateEmails.push(email);
      } else {
        emailMap.set(email, parent);
      }
    }
  }

  if (duplicateEmails.length > 0) {
    const message = `The following email(s) already exist in the system: ${duplicateEmails.join(
      ", "
    )}. Please use different email(s).`;
    if (DEBUG) console.warn("❌ Duplicate emails found.");
    await logActivity(req, PANEL, MODULE, "create", { message }, false);
    return res.status(409).json({ status: false, message });
  }

  try {
    if (DEBUG) console.log("🚀 Creating booking...");
    // const result = await BookingTrialService.createBooking(formData);
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

    const result = await BookingTrialService.createBooking(formData, {
      source: req.source,
      adminId: req.admin?.id, // <-- pass adminId here
      adminFirstName: req.admin?.firstName || "Unknown",
      leadId,
    });

    if (!result.status) {
      if (DEBUG) console.error("❌ Booking service error:", result.message);
      await logActivity(req, PANEL, MODULE, "create", result, false);
      return res.status(500).json({ status: false, message: result.message });
    }

    const booking = result.data.booking;
    const studentId = result.data.studentId;
    const studentFirstName = result.data.studentFirstName;
    const studentLastName = result.data.studentLastName;

    // Create parent admin accounts

    // // Send email
    // const parentMetas = await BookingParentMeta.findAll({
    //   where: { studentId },
    // });

    // if (parentMetas && parentMetas.length > 0) {
    //   const {
    //     status: configStatus,
    //     emailConfig,
    //     htmlTemplate,
    //     subject,
    //   } = await emailModel.getEmailConfig(PANEL, "free-trial-confirmation");

    //   if (configStatus && htmlTemplate) {
    //     const recipients = parentMetas.map((p) => ({
    //       name: `${p.parentFirstName} ${p.parentLastName}`,
    //       email: p.parentEmail,
    //     }));

    //     for (const recipient of recipients) {
    //       const variables = {
    //         "{{parentName}}": recipient.name,
    //         "{{parentEmail}}": recipient.email,
    //         "{{parentPassword}}": "Synco123",
    //         "{{studentFirstName}}": studentFirstName || "",
    //         "{{studentLastName}}": studentLastName || "",
    //         "{{venueName}}": venue?.name || "N/A",
    //         "{{className}}": classData?.className || "N/A",
    //         "{{trialDate}}": booking?.trialDate || "",
    //         "{{classTime}}": classData?.startTime || "",
    //         "{{logoUrl}}": "https://webstepdev.com/demo/syncoUploads/syncoLogo.png",
    //         "{{kidsPlaying}}": "https://webstepdev.com/demo/syncoUploads/kidsPlaying.png",
    //         "{{appName}}": "Synco",
    //         "{{year}}": new Date().getFullYear().toString(),
    //       };

    //       let finalHtml = htmlTemplate;
    //       for (const [key, val] of Object.entries(variables)) {
    //         const safeKey = key.replace(/[{}]/g, "").trim(); // remove braces and spaces
    //         const regex = new RegExp(`{{\\s*${safeKey}\\s*}}`, "g"); // match {{ parentName }} or {{parentName}}
    //         finalHtml = finalHtml.replace(regex, val);
    //       }

    //       await sendEmail(emailConfig, {
    //         recipient: [recipient],
    //         cc: emailConfig.cc || [],
    //         bcc: emailConfig.bcc || [],
    //         subject,
    //         htmlBody: finalHtml,
    //       });
    //     }
    //   }
    // }
    // Send email
    const parentMetas = await BookingParentMeta.findAll({
      where: { studentId },
    });

    if (parentMetas && parentMetas.length > 0) {
      const {
        status: configStatus,
        emailConfig,
        htmlTemplate,
        subject,
      } = await emailModel.getEmailConfig(PANEL, "free-trial-confirmation");

      if (configStatus && htmlTemplate) {
        const recipients = parentMetas.map((p) => ({
          name: `${p.parentFirstName} ${p.parentLastName}`,
          email: p.parentEmail,
        }));

        for (const recipient of recipients) {
          const variables = {
            "{{parentName}}": recipient.name,
            "{{parentEmail}}": recipient.email,
            "{{parentPassword}}": "Synco123",
            "{{studentFirstName}}": studentFirstName || "",
            "{{studentLastName}}": studentLastName || "",
            "{{venueName}}": venue?.name || "N/A",
            "{{className}}": classData?.className || "N/A",
            "{{trialDate}}": booking?.trialDate || "",
            "{{classTime}}": classData?.startTime || "",
            "{{logoUrl}}":
              "https://webstepdev.com/demo/syncoUploads/syncoLogo.png",
            "{{kidsPlaying}}":
              "https://webstepdev.com/demo/syncoUploads/kidsPlaying.png",
            "{{appName}}": "Synco",
            "{{year}}": new Date().getFullYear().toString(),
          };

          let finalHtml = htmlTemplate;
          for (const [key, val] of Object.entries(variables)) {
            const safeKey = key.replace(/[{}]/g, "").trim(); // remove braces and spaces
            const regex = new RegExp(`{{\\s*${safeKey}\\s*}}`, "g"); // match {{ parentName }} or {{parentName}}
            finalHtml = finalHtml.replace(regex, val);
          }

          await sendEmail(emailConfig, {
            recipient: [recipient],
            cc: emailConfig.cc || [],
            bcc: emailConfig.bcc || [],
            subject,
            htmlBody: finalHtml,
          });
        }
      }
    }

    if (DEBUG) console.log("📝 Logging activity...");
    await logActivity(req, PANEL, MODULE, "create", result, true);

    if (DEBUG) console.log("🔔 Creating notification...");
    await createNotification(
      req,
      "New Booking Created",
      `Booking "${classData.className}" has been scheduled on ${formData.trialDate} from ${classData.startTime} to ${classData.endTime}.`,
      "System"
    );

    if (DEBUG) console.log("✅ Booking created successfully.");
    return res.status(201).json({
      status: true,
      message: "Booking created successfully. Confirmation email sent.",
      data: booking,
    });
  } catch (error) {
    if (DEBUG) console.error("❌ Booking creation error:", error);
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

/**
 * ✅ GET ALL BOOKINGS (with students)
 */
exports.getAllBookFreeTrials = async (req, res) => {
  if (DEBUG) console.log("📥 Fetching all free trial bookings...");

  const bookedBy = req.admin?.id;
  const mainSuperAdminResult = await getMainSuperAdminOfAdmin(req.admin.id, true);
  const superAdminId = mainSuperAdminResult?.superAdmin?.id ?? null;

  const filters = {
    studentName: req.query.studentName,
    trialDate: req.query.trialDate,
    status: req.query.status,
    venueId: req.query.venueId,
    venueName: req.query.venueName,
    // source: req.query.source,
    dateTrialFrom: req.query.dateTrialFrom
      ? req.query.dateTrialFrom
      : undefined,
    dateTrialTo: req.query.dateTrialTo ? req.query.dateTrialTo : undefined,
    fromDate: req.query.fromDate ? req.query.fromDate : undefined, // ✅ added
    toDate: req.query.toDate ? req.query.toDate : undefined, // ✅ added
  };

  try {
    // ✅ Apply bookedBy filter
    if (req.admin?.role?.toLowerCase() === 'super admin') {
      const admins = mainSuperAdminResult?.admins || [];
      filters.bookedBy = admins.length > 0 ? admins.map(a => a.id) : [];
    } else {
      // Always assign bookedBy even if not in query
      filters.bookedBy = bookedBy || null;
    }

    const result = await BookingTrialService.getAllBookings(
      filters
    );

    if (!result.status) {
      await logActivity(req, PANEL, MODULE, "list", result, false);
      return res.status(500).json({ status: false, message: result.message });
    }

    await logActivity(
      req,
      PANEL,
      MODULE,
      "list",
      { message: `Fetched ${result.data.length} bookings.` },
      true
    );

    return res.status(200).json({
      status: true,
      message: "Fetched free trial bookings successfully.",
      totalFreeTrials: result.totalFreeTrials,
      data: result.data,
    });
  } catch (error) {
    console.error("❌ Error fetching free trials:", error);
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

/**
 * ✅ GET SINGLE BOOKING (unwraps metas into students[])
 */
exports.getBookFreeTrialDetails = async (req, res) => {
  const { id } = req.params;
  const adminId = req.admin?.id;
  if (DEBUG) console.log(`🔍 Fetching free trial booking ID: ${id}`);
  const bookedBy = req.admin?.id;
  const mainSuperAdminResult = await getMainSuperAdminOfAdmin(req.admin.id);
  const superAdminId = mainSuperAdminResult?.superAdmin.id ?? null;

  try {
    // const result = await BookingTrialService.getBookingById(id);
    const result = await BookingTrialService.getBookingById(
      id,
      adminId,
      superAdminId
    ); // ✅ pass adminId

    if (!result.status) {
      return res.status(404).json({ status: false, message: result.message });
    }

    await logActivity(
      req,
      PANEL,
      MODULE,
      "getById",
      { message: `Fetched booking ID: ${id}` },
      true
    );

    return res.status(200).json({
      status: true,
      message: "Fetched booking details successfully.",
      data: result.data,
    });
  } catch (error) {
    console.error("❌ Error fetching booking:", error);
    await logActivity(
      req,
      PANEL,
      MODULE,
      "getById",
      { error: error.message },
      false
    );
    return res.status(500).json({ status: false, message: "Server error." });
  }
};

//send reebooking email
exports.sendSelectedTrialistEmail = async (req, res) => {
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
      const result = await BookingTrialService.sendAllEmailToParents({
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

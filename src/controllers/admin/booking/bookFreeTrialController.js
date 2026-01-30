const { validateFormData } = require("../../../utils/validateFormData");
const BookingTrialService = require("../../../services/admin/booking/bookingTrial");
const { logActivity } = require("../../../utils/admin/activityLogger");
const { Venue, ClassSchedule, Admin } = require("../../../models");
const emailModel = require("../../../services/email");
const sendEmail = require("../../../utils/email/sendEmail");
const {
  BookingParentMeta,
  BookingStudentMeta,
  Booking,
} = require("../../../models");
const { getMainSuperAdminOfAdmin } = require("../../../utils/auth");
const {
  createNotification,
  createCustomNotificationForAdmins
} = require("../../../utils/admin/notificationHelper");
const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "book-free-trial";

// Create Book a Free Trial
exports.createBooking = async (req, res) => {
  if (DEBUG) console.log("📥 Received booking request");
  const formData = req.body;
  const isParentPortalBooking = !!req.params.parentAdminId;
  if (
    isParentPortalBooking &&
    req.admin &&
    req.admin.role === "parent" &&
    req.admin.id !== parseInt(req.params.parentAdminId, 10)
  ) {
    return res.status(403).json({
      status: false,
      message: "You are not authorized to create booking for this parent.",
    });
  }

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
      // "emergency",
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

    // ✅ Emergency contact is OPTIONAL
    const emergency = req.body.emergency;

    if (emergency) {
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

      const rawEmail = parent.parentEmail;
      const emailvalid = rawEmail.trim().toLowerCase();

      // 🚫 Check for spaces
      if (/\s/.test(rawEmail)) {
        return res.status(400).json({
          status: false,
          message: `Parent email "${rawEmail}" should not contain spaces.`,
        });
      }

      // 🚫 Check for invalid characters
      const invalidCharRegex = /[^a-zA-Z0-9@._\-+]/;
      if (invalidCharRegex.test(emailvalid)) {
        return res.status(400).json({
          status: false,
          message: `Parent email "${rawEmail}" contains invalid characters.`,
        });
      }

      // 🚫 Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;
      if (!emailRegex.test(emailvalid)) {
        return res.status(400).json({
          status: false,
          message: `Parent email "${rawEmail}" is not a valid email address format.`,
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

      emailMap.set(email, parent);

      if (!isParentPortalBooking) {
        const exists = await Admin.findOne({ where: { email } });
        if (exists) {
          duplicateEmails.push(email);
        }
      }

    }
  }

  if (duplicateEmails.length > 0) {
    const unique = [...new Set(duplicateEmails)]; // remove duplicates
    const message =
      unique.length === 1
        ? `${unique[0]} email already in use.`
        : `${unique.join(", ")} emails already in use.`;

    if (DEBUG) console.warn("❌ Duplicate email(s) found.");
    await logActivity(req, PANEL, MODULE, "create", { message }, false);

    return res.status(409).json({ status: false, message });
  }

  try {
    if (DEBUG) console.log("🚀 Creating booking...");
    // const result = await BookingTrialService.createBooking(formData);
    const leadId = req.params.leadId || null;
    const parentAdminId = req.params.parentAdminId
      ? parseInt(req.params.parentAdminId, 10)
      : null;
    const result = await BookingTrialService.createBooking(formData, {
      // source: req.source,
      adminId: req.admin?.id, // <-- pass adminId here
      parentAdminId,
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

    // Send email to only the first parent
    // Send email
    const parentMetas = await BookingParentMeta.findAll({
      where: { studentId },
    });

    if (parentMetas && parentMetas.length > 0) {
      const firstParent = parentMetas[0]; // only first parent
      const {
        status: configStatus,
        emailConfig,
        htmlTemplate,
        subject,
      } = await emailModel.getEmailConfig(PANEL, "free-trial-confirmation");

      if (configStatus && htmlTemplate) {
        try {
          // ----------------------------
          // Safely get students for this parent
          // ----------------------------
          // Fetch ALL students for this booking
          const students = await BookingStudentMeta.findAll({
            where: { bookingTrialId: booking.id },
          });

          const studentsHtml = students.length
            ? students
              .map(
                (s) =>
                  `<p style="margin:0; font-size:13px; color:#5F5F6D;">
             ${s.studentFirstName} ${s.studentLastName}
           </p>`
              )
              .join("")
            : `<p style="margin:0; font-size:13px; color:#5F5F6D;">N/A</p>`;

          let finalHtml = htmlTemplate
            .replace(
              /{{parentName}}/g,
              `${firstParent.parentFirstName} ${firstParent.parentLastName}`
            )
            .replace(/{{parentEmail}}/g, firstParent.parentEmail || "")
            .replace(/{{parentPassword}}/g, "Synco123")
            .replace(/{{venueName}}/g, venue?.name || "N/A")
            .replace(/{{trialDate}}/g, booking?.trialDate || "")
            .replace(/{{className}}/g, classData?.className || "N/A")
            .replace(
              /{{classTime}}/g,
              `${classData?.startTime || ""}-${classData?.endTime || ""}`
            )
            .replace(/{{studentsHtml}}/g, studentsHtml)
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
                name: `${firstParent.parentFirstName} ${firstParent.parentLastName}`,
                email: firstParent.parentEmail,
              },
            ],
            cc: emailConfig.cc || [],
            bcc: emailConfig.bcc || [],
            subject,
            htmlBody: finalHtml,
          });
        } catch (err) {
          console.error(
            `❌ Failed to send email to ${firstParent.parentEmail}:`,
            err.message
          );
        }
      }
    }

    if (DEBUG) console.log("📝 Logging activity...");
    const actualParentAdminId = booking.parentAdminId;

    if (actualParentAdminId) {
      await createCustomNotificationForAdmins({
        title: "Free Trial Booked",
        description: `Your free trial for "${classData.className}" is scheduled on ${formData.trialDate} from ${classData.startTime} to ${classData.endTime}.`,
        category: "Updates",
        createdByAdminId: req.admin.id,
        recipientAdminIds: [actualParentAdminId],
      });

      console.log(
        "🔔 Custom notification sent to parentAdminId:",
        actualParentAdminId
      );
    }

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
exports.sendBookingSMSToParents = async (req, res) => {
  try {
    const { bookingId } = req.body;

    if (!bookingId) {
      return res.status(400).json({
        status: false,
        message: "bookingId is required",
      });
    }

    const result = await BookingTrialService.sendAllSMSToParents({ bookingId });

    await logActivity(
      req,
      PANEL,
      MODULE,
      "send-sms",
      { bookingId, result },
      result.status
    );

    return res.status(result.status ? 200 : 400).json(result);
  } catch (error) {
    console.error("❌ sendBookingSMSToParents Error:", error);

    await logActivity(
      req,
      PANEL,
      MODULE,
      "send-sms",
      { error: error.message },
      false
    );

    return res.status(500).json({
      status: false,
      message: "Internal server error",
    });
  }
};
// Website Preview
exports.getBookingByIdForWebsitePreview = async (req, res) => {
  const { id } = req.params;
  // const adminId = req.admin?.id;
  if (DEBUG) console.log(`🔍 Fetching free trial booking ID: ${id}`);
  try {
    const result = await BookingTrialService.getBookingByIdForWebsitePreview(id);

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

exports.getAllAgents = async (req, res) => {
  if (DEBUG) console.log("📋 Request received to list all admins");
  const mainSuperAdminResult = await getMainSuperAdminOfAdmin(req.admin?.id);
  const superAdminId = mainSuperAdminResult?.superAdmin.id ?? null;
  try {
    const loggedInAdminId = req.admin?.id; // Get the current admin's ID

    const result = await BookingTrialService.getAllAgents(superAdminId, loggedInAdminId); // Pass it to the service

    if (!result.status) {
      if (DEBUG) console.log("❌ Failed to retrieve admins:", result.message);

      await logActivity(req, PANEL, MODULE, "list", result, false);
      return res.status(500).json({
        status: false,
        message: result.message || "Failed to fetch admins.",
      });
    }

    if (DEBUG) {
      console.log(`✅ Retrieved ${result.data.length} admin(s)`);
      console.table(
        result.data.map((m) => ({
          ID: m.id,
          Name: m.name,
          Email: m.email,
          Created: m.createdAt,
        }))
      );
    }

    await logActivity(
      req,
      PANEL,
      MODULE,
      "list",
      {
        oneLineMessage: `Fetched ${result.data.length} admin(s) successfully.`,
      },
      true
    );

    return res.status(200).json({
      status: true,
      message: `Fetched ${result.data.length} admin(s) successfully.`,
      data: result.data,
    });
  } catch (error) {
    console.error("❌ List Admins Error:", error);
    return res.status(500).json({
      status: false,
      message: "Failed to fetch admins. Please try again later.",
    });
  }
};

// Assign Booking to Admin / Agent
exports.assignBookings = async (req, res) => {
  try {
    const { bookingIds, bookedBy } = req.body;

    if (!Array.isArray(bookingIds) || bookingIds.length === 0) {
      return res.status(400).json({
        status: false,
        message: "Booking IDs array is required.",
      });
    }

    if (!bookedBy || isNaN(Number(bookedBy))) {
      return res.status(400).json({
        status: false,
        message: "Valid admin ID is required.",
      });
    }

    const result = await BookingTrialService.assignBookingsToAgent({
      bookingIds,
      bookedBy,
    });

    if (!result.status) {
      await logActivity(req, PANEL, MODULE, "update", result, false);
      return res.status(400).json(result);
    }

    await createNotification(
      req,
      "Bookings Assigned",
      `${bookingIds.length} booking(s) assigned to agent successfully.`,
      "System"
    );

    await logActivity(
      req,
      PANEL,
      MODULE,
      "update",
      {
        oneLineMessage: `Assigned ${bookingIds.length} bookings to admin ${bookedBy}`,
      },
      true
    );

    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({
      status: false,
      message: "Failed to assign bookings.",
    });
  }
};

/**
 * ✅ GET ALL BOOKINGS (with students)
 */
exports.getAllBookFreeTrials = async (req, res) => {
  if (DEBUG) console.log("📥 Fetching all free trial bookings...");

  const bookedBy = req.admin?.id;
  const mainSuperAdminResult = await getMainSuperAdminOfAdmin(
    req.admin.id,
    true
  );
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
    // bookedBy: req.query.bookedBy,
  };

  try {
    // ✅ Resolve bookedBy filter safely
    const bookedByQuery = req.query.bookedBy;
    const role = req.admin?.role?.toLowerCase();

    // ----------------------------------
    // CASE 1: bookedBy explicitly sent
    // ----------------------------------
    if (
      bookedByQuery !== undefined &&
      bookedByQuery !== null &&
      bookedByQuery !== ""
    ) {
      if (Array.isArray(bookedByQuery)) {
        filters.bookedBy = bookedByQuery.map(Number).filter(Boolean);
      } else {
        filters.bookedBy = bookedByQuery.split(",").map(Number).filter(Boolean);
      }
    }

    // ----------------------------------
    // CASE 2: bookedBy NOT sent → role-based default
    // ----------------------------------
    else {
      // ✅ SUPER ADMIN → self + child admins + website
      if (role === "super admin") {
        const childAdminIds = (mainSuperAdminResult?.admins || []).map(
          (a) => a.id
        );

        filters.bookedBy = {
          type: "super_admin",
          adminIds: [req.admin.id, ...childAdminIds],
        };
      }

      // ✅ ADMIN → self + super admin + website
      else if (role === "admin") {
        filters.bookedBy = {
          type: "admin",
          adminIds: [req.admin.id, mainSuperAdminResult?.superAdmin?.id].filter(
            Boolean
          ),
        };
      }

      // ✅ AGENT → only self
      else {
        filters.bookedBy = {
          type: "agent",
          adminIds: [req.admin.id],
        };
      }
    }

    const result = await BookingTrialService.getAllBookings(filters);

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

//send  email
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

const { validateFormData } = require("../../../utils/validateFormData");
const BookingTrialService = require("../../../services/admin/booking/waitingList");
const { logActivity } = require("../../../utils/admin/activityLogger");
const { sequelize, Booking } = require("../../../models");

const {
  Venue,
  ClassSchedule,
  Admin,
  BookingParentMeta,
} = require("../../../models");
const emailModel = require("../../../services/email");
const sendEmail = require("../../../utils/email/sendEmail");
const {
  createNotification,
} = require("../../../utils/admin/notificationHelper");
const { getMainSuperAdminOfAdmin } = require("../../../utils/auth");

const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "waiting_list";

// Create Book a Free Trial
exports.createBooking = async (req, res) => {
  if (DEBUG) console.log("📥 Received booking request");
  const formData = req.body;

  if (DEBUG) console.log("🔍 Fetching class data...");
  const classData = await ClassSchedule.findByPk(formData.classScheduleId);
  if (!classData) {
    if (DEBUG) console.warn("❌ Class not found.");
    return res.status(404).json({ status: false, message: "Class not found." });
  }

  if (DEBUG) console.log("✅ Validating form data...");
  const { isValid, error } = validateFormData(formData, {
    requiredFields: [
      "totalStudents",
      "classScheduleId",
      "interest",
      "startDate",
      "students", // array, validate inside loop
      "parents", // array, validate inside loop
      "emergency", // object, validate inside
    ],
  });

  // Validate students
  if (!Array.isArray(formData.students) || formData.students.length === 0) {
    return res.status(400).json({
      status: false,
      message: "At least one student must be provided.",
    });
  }

  for (const student of formData.students) {
    const { isValid, error } = validateFormData(student, {
      requiredFields: [
        "studentFirstName",
        "studentLastName",
        "dateOfBirth",
        "medicalInformation",
      ],
    });
    if (!isValid) {
      return res.status(400).json({ status: false, ...error });
    }
  }

  // Validate parents
  if (!Array.isArray(formData.parents) || formData.parents.length === 0) {
    return res.status(400).json({
      status: false,
      message: "At least one parent must be provided.",
    });
  }

  for (const parent of formData.parents) {
    const { isValid, error } = validateFormData(parent, {
      requiredFields: [
        "parentFirstName",
        "parentLastName",
        "parentEmail",
        "parentPhoneNumber",
      ],
    });
    if (!isValid) {
      return res.status(400).json({ status: false, ...error });
    }
  }

  // Validate emergency
  const { isValid: isEmergencyValid, error: emergencyError } = validateFormData(
    formData.emergency,
    {
      requiredFields: [
        "emergencyFirstName",
        "emergencyLastName",
        "emergencyPhoneNumber",
        "emergencyRelation",
      ],
    }
  );
  if (!isEmergencyValid) {
    return res.status(400).json({ status: false, ...emergencyError });
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
    if (
      !student.studentFirstName ||
      !student.dateOfBirth ||
      !student.medicalInformation
    ) {
      if (DEBUG) console.warn("❌ Missing student info.");
      return res.status(400).json({
        status: false,
        message:
          "Each student must have a name, date of birth, and medical information.",
      });
    }

    const emergency = formData.emergency;
    if (
      !emergency ||
      !emergency.emergencyFirstName ||
      !emergency.emergencyPhoneNumber
    ) {
      return res.status(400).json({
        status: false,
        message:
          "A valid emergency contact (first name and phone) is required.",
      });
    }

    student.className = classData.className;
    student.startTime = classData.startTime;
    student.endTime = classData.endTime;

    const parents = [
      ...(student.parents || []),
      ...(student.secondParentDetails ? [student.secondParentDetails] : []),
    ];

    for (const parent of parents) {
      const email = parent?.parentEmail?.trim()?.toLowerCase();
      if (!email || !parent.parentFirstName || !parent.parentPhoneNumber) {
        if (DEBUG) console.warn("❌ Missing parent info.");
        return res.status(400).json({
          status: false,
          message: "Each parent must have a name, email, and phone number.",
        });
      }

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
      adminId: req.admin?.id,
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

    // Send confirmation email to parents
    const parentMetas = await BookingParentMeta.findAll({
      where: { studentId },
    });

    if (parentMetas && parentMetas.length > 0) {
      const {
        status: configStatus,
        emailConfig,
        htmlTemplate,
        subject,
      } = await emailModel.getEmailConfig(PANEL, "waiting-list");

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
            "{{startDate}}": booking?.startDate || "",
            "{{classTime}}": classData?.startTime || "",
            "{{appName}}": "Synco",
            "{{year}}": new Date().getFullYear().toString(),
            "{{logoUrl}}":
              "https://webstepdev.com/demo/syncoUploads/syncoLogo.png",
            "{{kidsPlaying}}":
              "https://webstepdev.com/demo/syncoUploads/kidsPlaying.png",
          };

          let finalHtml = htmlTemplate;
          for (const [key, val] of Object.entries(variables)) {
            finalHtml = finalHtml.replace(new RegExp(key, "g"), val);
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
      "New Booking Created For Waiting List",
      `Booking "${classData.className}" has been scheduled on ${formData.startDate} from ${classData.startTime} to ${classData.endTime}.`,
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

// 📌 Get All Waiting List Bookings
exports.getAllWaitingListBookings = async (req, res) => {
  console.debug("🔹 getAllWaitingListBookings called with query:", req.query);
  try {
    const bookedBy = req.admin?.id;
    const mainSuperAdminResult = await getMainSuperAdminOfAdmin(
      req.admin.id,
      true
    );
    const superAdminId = mainSuperAdminResult?.superAdmin?.id ?? null;

    const filters = {
      ...req.query,
    };

    // ✅ Apply bookedBy filter
    if (req.admin?.role?.toLowerCase() === "super admin") {
      const admins = mainSuperAdminResult?.admins || [];
      filters.bookedBy = admins.length > 0 ? admins.map((a) => a.id) : [];
    } else {
      // Always assign bookedBy even if not in query
      filters.bookedBy = bookedBy || null;
    }

    const result = await BookingTrialService.getWaitingList(filters);

    console.debug(
      "🔹 Result from getWaitingList:",
      JSON.stringify(result, null, 2)
    );

    if (!result.status) {
      console.warn("⚠️ Failed to fetch waiting list bookings:", result.message);
      await logActivity(req, PANEL, MODULE, "read", result, false);
      return res.status(400).json({ status: false, message: result.message });
    }

    await logActivity(
      req,
      PANEL,
      MODULE,
      "read",
      { message: "Fetched all waiting list bookings successfully." },
      true
    );

    console.debug(
      `✅ Successfully fetched ${result.data.waitingList.length} waiting list bookings`
    );

    return res.status(200).json({
      status: true,
      message: "Waiting list bookings fetched successfully.",
      data: result.data,
    });
  } catch (error) {
    console.error("❌ Error fetching waiting list bookings:", error);
    await logActivity(
      req,
      PANEL,
      MODULE,
      "read",
      { error: error.message },
      false
    );
    return res.status(500).json({ status: false, message: "Server error." });
  }
};

exports.sendEmail = async (req, res) => {
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

exports.getAccountProfile = async (req, res) => {
  const { id } = req.params;
  const adminId = req.admin?.id;
  const superAdminId = req.admin?.superAdminId || adminId; // ✅ Include superAdminId (fallback to self)

  if (DEBUG) {
    console.log("==============================================");
    console.log("📘 [getAccountProfile] API Call Started");
    console.log("🔍 Params:", { id });
    console.log("👤 Admin Info:", {
      adminId,
      superAdminId,
      email: req.admin?.email,
      roleId: req.admin?.roleId,
    });
    console.log("==============================================");
  }

  try {
    // ✅ Pass both adminId and superAdminId to service
    if (DEBUG) console.log("🚀 Calling BookingTrialService.getBookingById...");
    const result = await BookingTrialService.getBookingById(
      id,
      adminId,
      superAdminId
    );

    if (DEBUG) {
      console.log("📦 Service Response:", JSON.stringify(result, null, 2));
    }

    // ⚠️ If booking not found or unauthorized
    if (!result.status) {
      if (DEBUG) console.warn(`⚠️ Booking ID ${id} not found or unauthorized.`);

      await logActivity(
        req,
        PANEL,
        MODULE,
        "getById",
        { message: `Booking not found: ${id}`, adminId, superAdminId },
        false
      );

      return res.status(404).json({
        status: false,
        message: result.message || "Booking not found or not authorized.",
      });
    }

    // ✅ Log successful activity
    await logActivity(
      req,
      PANEL,
      MODULE,
      "getById",
      { message: `Fetched booking ID: ${id}`, adminId, superAdminId },
      true
    );

    if (DEBUG) {
      console.log("✅ Booking fetched successfully from service.");
      console.log("📤 Sending response to client...");
    }

    return res.status(200).json({
      status: true,
      message: "Fetched booking details successfully.",
      data: result.data,
    });
  } catch (error) {
    console.error("❌ Error in getAccountProfile:", error);

    await logActivity(
      req,
      PANEL,
      MODULE,
      "getById",
      { error: error.message, stack: error.stack, adminId, superAdminId },
      false
    );

    if (DEBUG) {
      console.error("💥 Detailed Error Trace:", error);
    }

    return res.status(500).json({
      status: false,
      message: "Server error while fetching booking.",
      error: DEBUG ? error.message : undefined, // show error only in debug mode
    });
  } finally {
    if (DEBUG) console.log("🏁 [getAccountProfile] Execution Completed\n");
  }
};

exports.updateWaitinglistBooking = async (req, res) => {
  const DEBUG = process.env.DEBUG === "true";

  try {
    if (DEBUG) console.log("🔹 Controller entered: updateWaitinglistBooking");

    const bookingId = req.params?.bookingId;
    const studentsPayload = req.body?.students || [];
    const adminId = req.admin?.id;

    // ✅ Security check
    if (!adminId)
      return res.status(401).json({ status: false, message: "Unauthorized" });

    // ✅ Validate bookingId
    if (!bookingId)
      return res
        .status(400)
        .json({ status: false, message: "Booking ID is required in URL" });

    // ✅ Validate payload
    if (!Array.isArray(studentsPayload) || studentsPayload.length === 0) {
      return res.status(400).json({
        status: false,
        message: "Students array is required and cannot be empty",
      });
    }

    studentsPayload.forEach((student) => {
      if (!student.id) throw new Error("Each student must have an ID");
      if (!Array.isArray(student.parents)) student.parents = [];
      if (!Array.isArray(student.emergencyContacts))
        student.emergencyContacts = [];
    });

    const t = await sequelize.transaction();
    const result = await BookingTrialService.updateBookingStudents(
      bookingId,
      studentsPayload,
      t
    );

    if (!result.status) {
      await t.rollback();
      return res.status(400).json(result);
    }

    await t.commit();
    if (DEBUG) console.log("✅ Transaction committed");

    // 🔹 Log activity
    await logActivity(
      req,
      PANEL,
      MODULE,
      "update",
      {
        message: `Updated student, parent, and emergency data for booking ID: ${bookingId}`,
      },
      true
    );

    // 🔹 Send notification
    await createNotification(
      req,
      "Booking Updated",
      `Student, parent, and emergency data updated for booking ID: ${bookingId}.`,
      "System"
    );

    if (DEBUG) console.log("✅ Controller finished successfully");

    return res.status(200).json(result);
  } catch (error) {
    if (DEBUG)
      console.error(
        "❌ Controller updateWaitinglistBooking Error:",
        error.message
      );
    return res.status(500).json({ status: false, message: error.message });
  }
};

exports.removeWaitingList = async (req, res) => {
  try {
    const { bookingId, removedReason, removedNotes } = req.body;
    // const removedBy = req.adminId?.id || null;

    if (DEBUG) {
      console.log("📥 removeWaitingList request:", {
        bookingId,
        removedReason,
        removedNotes,
        // removedBy,
      });
    }

    if (!bookingId || !removedReason) {
      if (DEBUG)
        console.log("❌ Validation failed: bookingId or removedReason missing");
      return res.status(400).json({
        status: false,
        message: "Booking ID and reason are required.",
      });
    }

    const result = await BookingTrialService.removeWaitingList({
      bookingId,
      // removedBy,
      reason: removedReason,
      notes: removedNotes,
    });

    if (!result.status) {
      if (DEBUG)
        console.log("❌ removeWaitingList service failed:", result.message);
      return res.status(404).json(result);
    }

    await createNotification(
      req,
      "Booking Removed From Waiting List",
      `Booking  was removed from waiting list. Reason: ${removedReason}`,
      "System"
    );

    if (DEBUG) console.log("✅ removeWaitingList success:", result.data);

    return res.status(200).json(result);
  } catch (error) {
    if (DEBUG)
      console.error("🔥 removeWaitingList Controller Error:", error.message);
    return res.status(500).json({
      status: false,
      message: "Server error while removing booking from waiting list.",
    });
  }
};

exports.convertToMembership = async (req, res) => {
  const formData = {
    ...req.body,
    id: req.params.id ? parseInt(req.params.id, 10) : req.body.id,
  };

  if (DEBUG)
    console.log("📥 [convertToMembership] Incoming formData:", formData);

  try {
    // Step 1: Validate class
    const classData = await ClassSchedule.findByPk(formData.classScheduleId);
    if (!classData) {
      if (DEBUG) console.log("❌ Class not found:", formData.classScheduleId);
      return res
        .status(404)
        .json({ status: false, message: "Class not found." });
    }

    if (DEBUG)
      console.log(
        "✅ Class found:",
        classData.className,
        "Capacity:",
        classData.capacity
      );

    // Step 2: Validate capacity
    if (classData.capacity < formData.totalStudents) {
      if (DEBUG)
        console.log("❌ Capacity exceeded:", {
          requested: formData.totalStudents,
          available: classData.capacity,
        });
      return res.status(400).json({
        status: false,
        message: `Only ${classData.capacity} slot(s) left for this class.`,
      });
    }

    // Step 3: Validate form
    const { isValid, error } = validateFormData(formData, {
      requiredFields: ["startDate", "totalStudents", "classScheduleId"],
    });
    if (!isValid) {
      if (DEBUG) console.log("❌ Validation failed:", error);
      await logActivity(req, PANEL, MODULE, "create", error, false);
      return res.status(400).json({ status: false, ...error });
    }

    if (!Array.isArray(formData.students) || formData.students.length === 0) {
      if (DEBUG) console.log("❌ No students provided");
      return res
        .status(400)
        .json({ status: false, message: "At least one student is required." });
    }

    // Step 4: Attach venueId
    formData.venueId = classData.venueId;

    if (DEBUG) console.log("📦 Final formData sent to service:", formData);

    // Step 5: Call Service
    const result = await BookingTrialService.convertToMembership(formData, {
      adminId: req.admin?.id || null,
    });

    if (DEBUG)
      console.log("🔄 Service response:", JSON.stringify(result, null, 2));

    if (!result.status) {
      await logActivity(req, PANEL, MODULE, "create", result, false);
      return res.status(500).json({ status: false, message: result.message });
    }

    const booking = result.data.booking;
    const studentIds = result.data.studentIds || [result.data.studentId];

    // Step 6: Send Emails to Parents
    const venue = await Venue.findByPk(classData.venueId);
    const venueName = venue?.venueName || venue?.name || "N/A";

    const {
      status: configStatus,
      emailConfig,
      htmlTemplate,
      subject,
    } = await emailModel.getEmailConfig(PANEL, "book-paid-trial");

    if (DEBUG)
      console.log("📧 Email config loaded:", { configStatus, subject });

    if (!configStatus || !htmlTemplate) {
      console.warn("⚠️ Email not sent: missing template for book-membership");
    } else if (studentIds?.length) {
      for (const sId of studentIds) {
        const parentMetas = await BookingParentMeta.findAll({
          where: { studentId: sId },
        });

        if (DEBUG) console.log(`👨‍👩‍👦 Parents for student ${sId}:`, parentMetas);

        for (const p of parentMetas) {
          try {
            const student =
              result.data.students?.find((st) => st.id === sId) || {};

            const htmlBody = htmlTemplate
              .replace(
                /{{parentName}}/g,
                `${p.parentFirstName} ${p.parentLastName}`
              )
              .replace(/{{studentFirstName}}/g, student.studentFirstName || "")
              .replace(/{{studentLastName}}/g, student.studentLastName || "")
              .replace(
                /{{studentName}}/g,
                `${student.studentFirstName || ""} ${
                  student.studentLastName || ""
                }`
              )
              .replace(/{{venueName}}/g, venueName)
              .replace(/{{className}}/g, classData.className || "N/A")
              .replace(
                /{{classTime}}/g,
                `${classData.startTime} - ${classData.endTime}`
              )
              .replace(
                /{{startDate}}/g,
                booking?.trialDate || formData.startDate
              )
              .replace(/{{parentEmail}}/g, p.parentEmail || "")
              .replace(/{{parentPassword}}/g, "Synco123")
              .replace(/{{appName}}/g, "Synco")
              .replace(/{{year}}/g, new Date().getFullYear().toString());

            if (DEBUG) console.log(`📨 Sending email to ${p.parentEmail}`);

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

            if (DEBUG) console.log(`✅ Email sent to ${p.parentEmail}`);
          } catch (err) {
            console.error(
              `❌ Failed to send email to ${p.parentEmail}:`,
              err.message
            );
          }
        }
      }
    }

    // Step 7: Notifications & Logs
    await createNotification(
      req,
      "New Membership Created",
      `Booking "${classData.className}" scheduled on ${formData.startDate}`,
      "System"
    );
    await logActivity(req, PANEL, MODULE, "create", result, true);

    return res.status(201).json({
      status: true,
      message:
        "Waiting to Membership Converted Successfully and Confirmation email sent.",
      data: booking,
    });
  } catch (error) {
    if (DEBUG) console.error("💥 Server error in convertToMembership:", error);
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

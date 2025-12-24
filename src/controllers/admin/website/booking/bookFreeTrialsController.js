const { validateFormData } = require("../../../../utils/validateFormData");
const BookingTrialService = require("../../../../services/admin/website/booking/bookFreeTrials");
const { logActivity } = require("../../../../utils/admin/activityLogger");
const { Venue, ClassSchedule, Admin } = require("../../../../models");
const emailModel = require("../../../../services/email");
const sendEmail = require("../../../../utils/email/sendEmail");
const {
  BookingParentMeta,
  BookingStudentMeta,
  Booking,
} = require("../../../../models");
const {
  createNotification,
} = require("../../../../utils/admin/notificationHelper");
const DEBUG = process.env.DEBUG === "true";
const PANEL = "Website";
const MODULE = "book-free-trial";

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
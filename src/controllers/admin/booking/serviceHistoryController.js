const { validateFormData } = require("../../../utils/validateFormData");
// const {BookingTrialService, sequelize}  = require("../../../services/admin/booking/serviceHistory");
const BookingTrialService = require("../../../services/admin/booking/serviceHistory");
const { sequelize, Booking, BookingStudentMeta,
  BookingParentMeta,
  BookingEmergencyMeta, } = require("../../../models"); // direct import

// const Admin = require("../../../services/admin/Admin");
const { logActivity } = require("../../../utils/admin/activityLogger");
const emailModel = require("../../../services/email");
const sendEmail = require("../../../utils/email/sendEmail");
const {
  createNotification,
} = require("../../../utils/admin/notificationHelper");

const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "service_history";
exports.updateBookingStudents = async (req, res) => {
  console.log("🔹 Step 0: Controller entered");

  // Extract bookingId from URL param
  const bookingId = req.params?.bookingId;
  console.log("req.params:", req.params);
  console.log("Booking ID resolved:", bookingId);

  // Extract payloads
  const studentsPayload = req.body?.students || [];
  const adminId = req.admin?.id;

  if (!bookingId) {
    console.error("❌ Booking ID missing.");
    return res.status(400).json({
      status: false,
      message: "Booking ID is required in URL (params.bookingId).",
    });
  }

  const t = await sequelize.transaction();

  try {
    console.log("🔹 Step 1: Fetching booking with students, parents, emergency contacts");

    // Fetch booking
    const booking = await Booking.findOne({
      where: { id: bookingId },
      include: [
        {
          model: BookingStudentMeta,
          as: "students",
          include: [
            { model: BookingParentMeta, as: "parents" },
            { model: BookingEmergencyMeta, as: "emergencyContacts" },
          ],
        },
      ],
      transaction: t,
    });

    if (!booking) throw new Error("Booking not found");

    console.log("🔹 Step 2: Updating students, parents, emergency contacts");

    for (const student of studentsPayload) {
      if (!student.id) continue;

      const studentRecord = booking.students.find((s) => s.id === student.id);
      if (!studentRecord) continue;

      // Update student fields
      ["studentFirstName", "studentLastName", "dateOfBirth", "age", "gender", "medicalInformation"].forEach(
        (field) => {
          if (student[field] !== undefined) studentRecord[field] = student[field];
        }
      );
      await studentRecord.save({ transaction: t });

      // Update parents
      if (Array.isArray(student.parents)) {
        for (const parent of student.parents) {
          if (!parent.id) continue;
          const parentRecord = studentRecord.parents.find((p) => p.id === parent.id);
          if (parentRecord) {
            ["parentFirstName", "parentLastName", "parentEmail", "parentPhoneNumber", "relationToChild", "howDidYouHear"].forEach(
              (field) => {
                if (parent[field] !== undefined) parentRecord[field] = parent[field];
              }
            );
            await parentRecord.save({ transaction: t });
          }
        }
      }

      // Update emergency contacts
      if (Array.isArray(student.emergencyContacts)) {
        for (const emergency of student.emergencyContacts) {
          if (!emergency.id) continue;
          const emergencyRecord = studentRecord.emergencyContacts.find((e) => e.id === emergency.id);
          if (emergencyRecord) {
            ["emergencyFirstName", "emergencyLastName", "emergencyPhoneNumber", "emergencyRelation"].forEach(
              (field) => {
                if (emergency[field] !== undefined) emergencyRecord[field] = emergency[field];
              }
            );
            await emergencyRecord.save({ transaction: t });
          }
        }
      }
    }

    await t.commit();
    console.log("✅ Step 3: Transaction committed successfully");

    // Optional: Log activity & notification
    await logActivity(
      req,
      PANEL,
      MODULE,
      "update",
      { message: `Updated student, parent, and emergency data for booking ID: ${bookingId}` },
      true
    );
    console.log("✅ Step 4: Activity logged");

    await createNotification(
      req,
      "Booking Updated",
      `Student, parent, and emergency data updated for booking ID: ${bookingId}.`,
      "System"
    );
    console.log("✅ Step 5: Notification created");

    return res.status(200).json({
      status: true,
      message: "Student, parent, and emergency contact data updated successfully",
    });
  } catch (error) {
    if (!t.finished) await t.rollback(); // only rollback if still active
    console.error("❌ updateBookingStudents Error:", error.message);
    return res.status(500).json({ status: false, message: error.message });
  }
};

exports.getAccountProfile = async (req, res) => {
  const { id } = req.params;
  const adminId = req.admin?.id;
  if (DEBUG) console.log(`🔍 Fetching free trial booking ID: ${id}`);

  try {
    // const result = await BookingTrialService.getBookingById(id);
    const result = await BookingTrialService.getBookingById(id, adminId); // ✅ pass adminId

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

exports.updateBooking = async (req, res) => {
  const adminId = req.admin?.id;
  const payload = req.body || {};

  // Prefer id from body, support either `id` or `bookingId`, fallback to URL param
  const id = payload.id || payload.bookingId || req.params.id;

  console.log(`✏️ Step 1: Updating booking ID: ${id}`, payload);

  try {
    if (!id) {
      console.log("❌ Booking ID missing.");
      return res.status(400).json({
        status: false,
        message:
          "Booking ID is required (body.id | body.bookingId | params.id).",
      });
    }

    // Step 2: Validate body fields
    const { isValid, error } = validateFormData(payload, {
      requiredFields: ["startDate", "totalStudents"], // adjust as needed
    });
    if (!isValid) {
      console.log("❌ Validation failed:", error);
      await logActivity(req, PANEL, MODULE, "update", error, false);
      return res.status(400).json({ status: false, ...error });
    }
    console.log("✅ Step 2: Validation passed");

    // Step 3: Call service to update booking
    console.log("🔄 Step 3: Calling BookingTrialService.updateBooking");
    const result = await BookingTrialService.updateBooking(
      payload,
      adminId,
      id
    );

    if (!result || result.status === false) {
      console.log("❌ Booking update failed:", result?.message);
      return res.status(404).json({
        status: false,
        message: result?.message || "Booking update failed.",
      });
    }

    const booking = result.data || result;
    console.log("✅ Step 3: Booking updated successfully:", booking.id);

    // Step 4: Email configuration fetch
    const classSchedule = booking.classSchedule;
    const venue = classSchedule?.venue || {};
    const venueName = venue.venueName || venue?.name || "N/A";

    console.log("🔄 Step 4: Fetching email configuration for book-paid-trial");
    const {
      status: configStatus,
      emailConfig,
      htmlTemplate,
      subject,
    } = await emailModel.getEmailConfig(PANEL, "book-paid-trial");

    console.log("📧 Step 4: Email config loaded:", {
      configStatus,
      subject,
      htmlTemplateLength: htmlTemplate?.length || 0,
    });

    // Step 5: Send emails to parents
    if (configStatus && htmlTemplate) {
      console.log("🔹 Step 5: Sending emails to parents...");
      for (const parent of booking.parents || []) {
        try {
          console.log(`🔹 Preparing email for parent: ${parent.parentEmail}`);

          const htmlBody = htmlTemplate
            .replace(
              /{{parentName}}/g,
              `${parent.parentFirstName} ${parent.parentLastName}`
            )
            .replace(/{{venueName}}/g, venueName)
            .replace(/{{className}}/g, classSchedule?.className || "N/A")
            .replace(
              /{{classTime}}/g,
              `${classSchedule?.startTime || ""} - ${classSchedule?.endTime || ""
              }`
            )
            .replace(/{{startDate}}/g, booking.startDate || "")
            .replace(/{{status}}/g, booking.status || "N/A")
            .replace(/{{year}}/g, new Date().getFullYear().toString());

          console.log("📨 Sending email to parent:", parent.parentEmail);

          await sendEmail({
            ...emailConfig,
            to: [
              {
                name: `${parent.parentFirstName} ${parent.parentLastName}`,
                email: parent.parentEmail,
              },
            ],
            subject,
            htmlBody,
          });

          console.log(`✅ Email successfully sent to ${parent.parentEmail}`);
        } catch (err) {
          console.error(
            `❌ Failed to send email to ${parent.parentEmail}:`,
            err.message
          );
        }
      }
    } else {
      console.warn(
        "⚠️ Step 5: Email not sent. Config missing or template empty."
      );
    }

    // Step 6: Log activity
    console.log("🔹 Step 6: Logging activity");
    await logActivity(
      req,
      PANEL,
      MODULE,
      "update",
      { message: `Updated booking ID: ${id}` },
      true
    );

    console.log("✅ Step 7: Completed updateBooking successfully");
    return res.status(200).json({
      status: true,
      message: "Booking updated successfully.",
      data: booking,
    });
  } catch (error) {
    console.error("❌ Step 8: Error updating booking:", error);
    await logActivity(
      req,
      PANEL,
      MODULE,
      "update",
      { error: error.message },
      false
    );
    return res.status(500).json({ status: false, message: "Server error." });
  }
};

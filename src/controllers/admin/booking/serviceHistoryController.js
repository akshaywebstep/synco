const { validateFormData } = require("../../../utils/validateFormData");
// const {BookingTrialService, sequelize}  = require("../../../services/admin/booking/serviceHistory");
const BookingTrialService = require("../../../services/admin/booking/serviceHistory");
const {
  sequelize,
  Booking,
  BookingStudentMeta,
  BookingParentMeta,
  BookingEmergencyMeta,
} = require("../../../models"); // direct import

// const Admin = require("../../../services/admin/Admin");
const { logActivity } = require("../../../utils/admin/activityLogger");
const { getMainSuperAdminOfAdmin } = require("../../../utils/auth");
const emailModel = require("../../../services/email");
const sendEmail = require("../../../utils/email/sendEmail");
const {
  createNotification,
} = require("../../../utils/admin/notificationHelper");

const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "service_history";
// Controller
exports.updateBookingStudents = async (req, res) => {
  // const DEBUG = process.env.DEBUG === "true";

  try {
    if (DEBUG) console.log("🔹 Controller entered: updateBookingStudents");

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

    // 🔹 Transaction
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
        "❌ Controller updateBookingStudents Error:",
        error.message
      );
    return res.status(500).json({ status: false, message: error.message });
  }
};

exports.getAccountProfile = async (req, res) => {
  const { id } = req.params;
  // const adminId = req.admin?.id;
  if (DEBUG) console.log(`🔍 Fetching free trial booking ID: ${id}`);

  let bookedBy;
  const mainSuperAdminResult = await getMainSuperAdminOfAdmin(req.admin.id, true);
  const superAdminId = mainSuperAdminResult?.superAdmin.id ?? null;

  // ✅ Apply bookedBy filter
  if (req.admin?.role?.toLowerCase() === 'super admin') {
    const admins = mainSuperAdminResult?.admins || [];
    bookedBy = admins.length > 0 ? admins.map(a => a.id) : [];
  } else {
    // Always assign bookedBy even if not in query
    bookedBy = req.admin?.id || null;
  }

  try {
    // const result = await BookingTrialService.getBookingById(id);
    const result = await BookingTrialService.getBookingById(id, bookedBy); // ✅ pass adminId

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
    const requiredFields = ["startDate", "totalStudents"];
    for (const field of requiredFields) {
      if (!payload[field]) {
        const message = `${field} is required.`;
        console.log("❌ Validation failed:", message);
        await logActivity(req, PANEL, MODULE, "update", { message }, false);
        return res.status(400).json({
          status: false,
          message,
        });
      }
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
      const message = result?.message || "Booking update failed.";
      console.log("❌ Booking update failed:", message);
      await logActivity(req, PANEL, MODULE, "update", { message }, false);
      return res.status(400).json({
        status: false,
        message,
      });
    }

    const booking = result.data || result;
    console.log("✅ Step 3: Booking updated successfully:", booking?.id || id);

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

const { validateFormData } = require("../../../utils/validateFormData");
// const {BookingTrialService, sequelize}  = require("../../../services/admin/booking/serviceHistory");
const BookingTrialService = require("../../../services/admin/booking/serviceHistory");
const {
  sequelize,
  Booking,
  BookingStudentMeta,
  BookingParentMeta,
  BookingEmergencyMeta,
  ClassSchedule,
  Venue,
} = require("../../../models"); // direct import

// const Admin = require("../../../services/admin/Admin");
const { logActivity } = require("../../../utils/admin/activityLogger");
const { getMainSuperAdminOfAdmin } = require("../../../utils/auth");
const emailModel = require("../../../services/email");
const sendEmail = require("../../../utils/email/sendEmail");
const {
  createNotification,
  createCustomNotificationForAdmins
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
    // 🔹 Fetch booking to get parentAdminId
    const booking = await Booking.findByPk(bookingId, {
      attributes: ["parentAdminId"],
    });
    // 🔹 Build readable update summary (no bookingId)
    const updatedParts = [];

    if (studentsPayload?.length) updatedParts.push("student details");

    if (
      studentsPayload.some(
        (s) => s.parents && s.parents.length > 0
      )
    ) {
      updatedParts.push("parent details");
    }

    if (
      studentsPayload.some(
        (s) => s.emergencyContacts && s.emergencyContacts.length > 0
      )
    ) {
      updatedParts.push("emergency contact details");
    }

    const updateSummary =
      updatedParts.length > 0
        ? `${updatedParts.join(", ")} updated successfully.`
        : "Booking details updated successfully.";

    // 🔹 Send custom notification to parent
    if (booking?.parentAdminId) {
      await createCustomNotificationForAdmins({
        title: "Booking Updated",
        description: updateSummary, // 👈 no bookingId
        category: "Updates",
        createdByAdminId: adminId,
        recipientAdminIds: [booking.parentAdminId],
      });
    }

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
      "Student, parent, and emergency data updated",
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

exports.updateBooking = async (req, res) => {
  const adminId = req.admin?.id;
  const payload = req.body || {};

  // Prefer id from body, fallbacks supported
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

    // Step 2: Validation
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

    // Step 3: Update booking
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
    // ---------------- EMAIL SECTION (FIXED) ----------------

    const classSchedule =
      booking.students?.[0]?.classSchedule || null;

    const venue = classSchedule?.venue || null;

    const venueName =
      venue?.venueName || venue?.name || "N/A";

    console.log("📧 Using venue:", venueName);
    console.log("📧 Using classSchedule:", classSchedule?.id);

    const {
      status: configStatus,
      emailConfig,
      htmlTemplate,
      subject,
    } = await emailModel.getEmailConfig(PANEL, "book-paid-trial");

    if (configStatus && htmlTemplate) {
      console.log("✔️ Email template loaded");

      for (const student of booking.students || []) {
        console.log("➡️ Processing student:", student.id);

        const parentMetas = await BookingParentMeta.findAll({
          where: { studentId: student.id },
        });

        if (!parentMetas.length) continue;

        const firstParent = parentMetas[0];
        if (!firstParent?.parentEmail) continue;

        // 🔥 Fetch ALL students WITH classSchedule
        const allStudents = await BookingStudentMeta.findAll({
          where: { bookingTrialId: booking.id },
          include: [
            {
              model: ClassSchedule,
              as: "classSchedule",
            },
          ],
        });

        const studentsHtml = allStudents.length
          ? allStudents
            .map(
              (s) =>
                `<p style="margin:0; font-size:13px; color:#5F5F6D;">
                ${s.studentFirstName} ${s.studentLastName}
              </p>`
            )
            .join("")
          : `<p style="margin:0;">N/A</p>`;

        let htmlBody = htmlTemplate
          .replace(
            /{{parentName}}/g,
            `${firstParent.parentFirstName} ${firstParent.parentLastName}`
          )
          .replace(/{{venueName}}/g, venueName)
          .replace(
            /{{className}}/g,
            classSchedule?.className || "N/A"
          )
          .replace(
            /{{classTime}}/g,
            classSchedule
              ? `${classSchedule.startTime} - ${classSchedule.endTime}`
              : "N/A"
          )
          .replace(
            /{{startDate}}/g,
            booking?.trialDate || ""
          )
          .replace(/{{parentEmail}}/g, firstParent.parentEmail)
          .replace(/{{parentPassword}}/g, "Synco123")
          .replace(/{{appName}}/g, "Synco")
          .replace(/{{year}}/g, new Date().getFullYear())
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
          subject,
          htmlBody,
        });

        console.log("📧 Email sent to:", firstParent.parentEmail);
      }
    } else {
      console.warn("⚠️ Email config missing or template empty");
    }
    // 🔔 Booking converted notification
    if (booking?.isConvertedToMembership) {
      const conversionMessage =
        "🎉 Your free trial booking has been successfully converted into a paid membership.";

      // 🔹 System notification (for activity feed)
      await createNotification(
        req,
        "Booking Converted",
        conversionMessage,
        "System"
      );

      // 🔹 Custom notification (for parent admin)
      if (booking?.parentAdminId) {
        await createCustomNotificationForAdmins({
          title: "Booking Converted Successfully 🎉",
          description:
            "Your free trial booking has now been converted into an active paid membership. You can view full class and payment details in your dashboard.",
          category: "Booking",
          createdByAdminId: adminId,
          recipientAdminIds: [booking.parentAdminId],
        });
      }
    }

    // -------------------------------------------------------------------

    // Step 6: Activity Log
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

exports.getAccountProfile = async (req, res) => {
  const { id } = req.params;
  // const adminId = req.admin?.id;
  if (DEBUG) console.log(`🔍 Fetching free trial booking ID: ${id}`);

  const role = req.admin?.role?.toLowerCase();
  const adminId = req.admin.id;

  const mainSuperAdminResult = await getMainSuperAdminOfAdmin(adminId, true);
  const superAdminId = mainSuperAdminResult?.superAdmin?.id ?? null;
  const childAdminIds = (mainSuperAdminResult?.admins || []).map((a) => a.id);

  try {
    const result = await BookingTrialService.getBookingById(id, {
      role,
      adminId,
      superAdminId,
      childAdminIds,
    });

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

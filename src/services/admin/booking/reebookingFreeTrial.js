const {
  Booking,
  BookingStudentMeta,
  BookingParentMeta,
  Venue,
  ClassSchedule,
  CancelBooking,
} = require("../../../models");
const { getEmailConfig } = require("../../email");
const sendEmail = require("../../../utils/email/sendEmail");

exports.createRebooking = async ({
  bookingId,
  reasonForNonAttendance,
  trialDate,
  additionalNote,
}) => {
  try {
    // 1️⃣ Find the booking
    const booking = await Booking.findByPk(bookingId);
    if (!booking) {
      return { status: false, message: "Booking not found." };
    }

    // 2️⃣ Date & status validation
    const today = new Date().toISOString().split("T")[0];
    const canRebook =
      booking.trialDate <= today ||
      booking.status === "cancelled" ||
      booking.status === "not attended";

    if (!canRebook) {
      return {
        status: false,
        message:
          "Rebooking is only allowed after the trial date has passed or if the booking is cancelled or not attended.",
      };
    }

    // 3️⃣ Prevent duplicate rebooking
    if (booking.reasonForNonAttendance) {
      return {
        status: false,
        message: "Booking already has a rebooking record.",
      };
    }

    // 4️⃣ Delete entry from cancelBooking table (if exists)
    await CancelBooking.destroy({
      where: { bookingId },
    });

    // 5️⃣ Update booking with rebooking info
    await booking.update({
      trialDate,
      status: "rebooked",
      reasonForNonAttendance,
      additionalNote: additionalNote || null,
    });

    return {
      status: true,
      message: "Booking updated and cancel record removed successfully.",
      data: booking,
    };
  } catch (error) {
    console.error("❌ createRebooking Error:", error);
    return { status: false, message: error.message };
  }
};

// ✅ Get all rebooking records
exports.getAllRebookings = async () => {
  try {
    const rebookings = await Booking.findAll({
      where: {
        reasonForNonAttendance: { [Op.ne]: null }, // only bookings with rebooking info
      },
      include: [
        {
          model: Venue,
          as: "venue",
          attributes: ["id", "venueName", "address"],
        },
        {
          model: ClassSchedule,
          as: "classSchedule",
          attributes: ["id", "className", "classTime", "startTime"],
        },
      ],
      order: [["updatedAt", "DESC"]],
    });

    return { status: true, data: rebookings };
  } catch (error) {
    console.error("❌ getAllRebookings Error:", error);
    return { status: false, message: error.message };
  }
};

exports.sendRebookingEmailToParents = async ({ bookingId }) => {
  try {
    const booking = await Booking.findByPk(bookingId);
    if (!booking) return { status: false, message: "Booking not found" };

    const studentMetas = await BookingStudentMeta.findAll({
      where: { bookingTrialId: bookingId },
    });

    if (!studentMetas.length)
      return { status: false, message: "No students found for this booking" };

    // load classSchedule (keep original fetch)
    const classSchedule = await ClassSchedule.findByPk(booking.classScheduleId);

    // --- REPLACED VENUE LOOKUP: TRY booking.venueId THEN classSchedule.venueId ---
    let venue = null;

    if (booking.venueId) {
      venue = await Venue.findByPk(booking.venueId);
    }

    if (!venue && classSchedule?.venueId) {
      venue = await Venue.findByPk(classSchedule.venueId);
    }

    const venueName = venue?.venueName || venue?.name || "Unknown Venue";
    // -------------------------------------------------------------------------

    const className = classSchedule?.className || "Unknown Class";
    const classTime =
      classSchedule?.classTime || classSchedule?.startTime || "TBA";
    const trialDate = booking.trialDate;
    const additionalNote = booking.additionalNote || "";

    const emailConfigResult = await getEmailConfig(
      "admin",
      "free-trial-rebooking"
    );
    if (!emailConfigResult.status)
      return { status: false, message: "Email config missing" };

    const { emailConfig, htmlTemplate, subject } = emailConfigResult;
    let sentTo = [];

    for (const student of studentMetas) {
      const parents = await BookingParentMeta.findAll({
        where: { studentId: student.id },
      });
      if (!parents.length) continue;

      let noteHtml = additionalNote.trim()
        ? `<p><strong>Additional Note:</strong> ${additionalNote}</p>`
        : "";

      for (const parent of parents) {
        if (!parent?.parentEmail) continue;

        const finalHtml = htmlTemplate
          .replace(/{{parentName}}/g, parent.parentFirstName)
          .replace(/{{studentFirstName}}/g, student.studentFirstName)
          .replace(/{{studentLastName}}/g, student.studentLastName)
          .replace(/{{venueName}}/g, venueName)
          .replace(/{{className}}/g, className)
          .replace(/{{classTime}}/g, classTime)
          .replace(/{{trialDate}}/g, trialDate)
          // .replace(/{{status}}/g, status)
          .replace(/{{status}}/g, booking.status || "N/A")
          .replace(/{{additionalNoteSection}}/g, noteHtml)
          .replace(/{{appName}}/g, "Synco")
          .replace(/{{year}}/g, new Date().getFullYear());

        const recipient = [
          {
            name: `${parent.parentFirstName} ${parent.parentLastName}`,
            email: parent.parentEmail,
          },
        ];
        const sendResult = await sendEmail(emailConfig, {
          recipient,
          subject,
          htmlBody: finalHtml,
        });

        if (sendResult.status) sentTo.push(parent.parentEmail);
      }
    }

    return {
      status: true,
      message: `Emails sent to ${sentTo.length} parents for booking ${bookingId}`,
      sentTo,
    };
  } catch (error) {
    console.error("❌ sendRebookingEmailToParents Error:", error);
    return { status: false, message: error.message };
  }
};

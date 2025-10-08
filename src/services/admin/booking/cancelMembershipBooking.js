const {
  CancelBooking,
  Booking,
  BookingStudentMeta,
  BookingParentMeta,
  BookingEmergencyMeta,
  PaymentPlan,
  Venue,
  ClassSchedule,
} = require("../../../models");
const { getEmailConfig } = require("../../email");
const sendEmail = require("../../../utils/email/sendEmail");
const { Op } = require("sequelize");

// services/BookingMembershipService.js
// exports.createCancelBooking = async ({
//   bookingId,
//   cancelReason,
//   additionalNote,
//   cancelDate = null, // null = immediate
// }) => {
//   try {
//     const bookingType = "membership";

//     // 🔹 Validate booking exists
//     const booking = await Booking.findByPk(bookingId);
//     if (!booking) return { status: false, message: "Booking not found." };

//     // 🔹 Check existing cancel record
//     const existingCancel = await CancelBooking.findOne({
//       where: { bookingId, bookingType },
//     });

//     // Determine cancellation type
//     const cancellationType = cancelDate ? "scheduled" : "immediate";

//     if (existingCancel) {
//       // 🔹 Update only provided fields
//       await existingCancel.update(
//         {
//           cancelReason: cancelReason ?? existingCancel.cancelReason,
//           additionalNote: additionalNote ?? existingCancel.additionalNote,
//           cancelDate: cancelDate ?? existingCancel.cancelDate,
//           cancellationType,
//         },
//         { returning: true }
//       );

//       // 🔹 Update booking status based on cancellation type
//       if (cancellationType === "immediate") {
//         await booking.update({ status: "cancelled" });
//       } else if (cancellationType === "scheduled") {
//         await booking.update({ status: "request_to_cancel" });
//       }

//       return {
//         status: true,
//         message: "Existing cancellation updated successfully.",
//         data: { cancelRequest: existingCancel, bookingDetails: booking },
//       };
//     }

//     // 🔹 Otherwise, create new cancel record
//     const cancelRequest = await CancelBooking.create({
//       bookingId,
//       bookingType,
//       cancelReason: cancelReason || null,
//       additionalNote: additionalNote || null,
//       cancelDate: cancelDate || null,
//       cancellationType,
//     });

//     // 🔹 Update booking status based on cancellation type
//     if (cancellationType === "immediate") {
//       await booking.update({ status: "cancelled" });
//       await booking.reload(); // ✅ ensure updated
//       console.log("🔄 Booking updated to cancelled:", booking.status);
//     }

//     return {
//       status: true,
//       message:
//         cancellationType === "immediate"
//           ? "Membership booking cancelled immediately."
//           : `Membership booking cancellation scheduled for ${cancelDate}.`,
//       data: { cancelRequest, bookingDetails: booking },
//     };
//   } catch (error) {
//     console.error("❌ createCancelBooking Error:", error);
//     return { status: false, message: error.message };
//   }
// };

exports.createCancelBooking = async ({
  bookingId,
  cancelReason,
  additionalNote,
  cancelDate = null, // null = immediate
}) => {
  try {
    const bookingType = "membership";

    // 🔹 Validate booking exists
    const booking = await Booking.findByPk(bookingId);
    if (!booking) return { status: false, message: "Booking not found." };

    // 🔹 Check existing cancel record
    const existingCancel = await CancelBooking.findOne({
      where: { bookingId, bookingType },
    });

    // Determine cancellation type
    const cancellationType = cancelDate ? "scheduled" : "immediate";

    if (existingCancel) {
      // 🔹 Update only provided fields
      await existingCancel.update(
        {
          cancelReason: cancelReason ?? existingCancel.cancelReason,
          additionalNote: additionalNote ?? existingCancel.additionalNote,
          cancelDate: cancelDate ?? existingCancel.cancelDate,
          cancellationType,
        },
        { returning: true }
      );

      // 🔹 Update booking status based on cancellation type
      if (cancellationType === "immediate") {
        await booking.update({ status: "cancelled" });

        // ✅ Update class capacity for immediate cancellations only
        const studentMetaList = await BookingStudentMeta.findAll({
          where: { bookingTrialId: bookingId },
        });

        if (studentMetaList.length > 0 && booking.classScheduleId) {
          const classSchedule = await ClassSchedule.findByPk(booking.classScheduleId);
          if (classSchedule) {
            const incrementCapacity = studentMetaList.length;
            await classSchedule.update({
              capacity: classSchedule.capacity + incrementCapacity,
            });
          }
        }
      } else if (cancellationType === "scheduled") {
        await booking.update({ status: "request_to_cancel" });
      }

      return {
        status: true,
        message: "Existing cancellation updated successfully.",
        data: { cancelRequest: existingCancel, bookingDetails: booking },
      };
    }

    // 🔹 Otherwise, create new cancel record
    const cancelRequest = await CancelBooking.create({
      bookingId,
      bookingType,
      cancelReason: cancelReason || null,
      additionalNote: additionalNote || null,
      cancelDate: cancelDate || null,
      cancellationType,
    });

    // 🔹 Update booking status based on cancellation type
    if (cancellationType === "immediate") {
      await booking.update({ status: "cancelled" });
      await booking.reload();

      // ✅ Update class capacity for immediate cancellations only
      const studentMetaList = await BookingStudentMeta.findAll({
        where: { bookingTrialId: bookingId },
      });

      if (studentMetaList.length > 0 && booking.classScheduleId) {
        const classSchedule = await ClassSchedule.findByPk(booking.classScheduleId);
        if (classSchedule) {
          const incrementCapacity = studentMetaList.length;
          await classSchedule.update({
            capacity: classSchedule.capacity + incrementCapacity,
          });
        }
      }
    }

    return {
      status: true,
      message:
        cancellationType === "immediate"
          ? "Membership booking cancelled immediately."
          : `Membership booking cancellation scheduled for ${cancelDate}.`,
      data: { cancelRequest, bookingDetails: booking },
    };
  } catch (error) {
    console.error("❌ createCancelBooking Error:", error);
    return { status: false, message: error.message };
  }
};

exports.sendCancelBookingEmailToParents = async ({ bookingId }) => {
  try {
    // 1️⃣ Get booking
    const booking = await Booking.findByPk(bookingId);
    if (!booking) {
      return { status: false, message: "Booking not found" };
    }

    // 2️⃣ Get students in the booking
    const studentMetas = await BookingStudentMeta.findAll({
      where: { bookingTrialId: bookingId },
    });

    if (!studentMetas.length) {
      return { status: false, message: "No students found for this booking" };
    }

    // 3️⃣ Venue & Class info
    const venue = await Venue.findByPk(booking.venueId);
    const classSchedule = await ClassSchedule.findByPk(booking.classScheduleId);

    const venueName = venue?.name || "Unknown Venue";
    const className = classSchedule?.className || "Unknown Class";
    const startTime = classSchedule?.startTime || "TBA";
    const endTime = classSchedule?.endTime || "TBA";
    const trialDate = booking.trialDate;
    const additionalNote = booking.additionalNote || "";

    // 4️⃣ Email config
    const emailConfigResult = await getEmailConfig("admin", "cancel-trial");
    if (!emailConfigResult.status) {
      return { status: false, message: "Email config missing" };
    }

    const { emailConfig, htmlTemplate, subject } = emailConfigResult;
    let sentTo = [];

    // 5️⃣ Loop over students
    for (const student of studentMetas) {
      const parents = await BookingParentMeta.findAll({
        where: { studentId: student.id },
      });

      if (!parents.length) continue;

      // Loop over ALL parents for this student
      for (const parent of parents) {
        if (!parent?.parentEmail) continue;

        let noteHtml = "";
        if (additionalNote.trim() !== "") {
          noteHtml = `<p><strong>Additional Note:</strong> ${additionalNote}</p>`;
        }

        let finalHtml = htmlTemplate
          .replace(/{{parentName}}/g, parent.parentFirstName)
          .replace(/{{studentName}}/g, student.studentFirstName)
          .replace(/{{venueName}}/g, venueName)
          .replace(/{{className}}/g, className)
          .replace(/{{startTime}}/g, startTime)
          .replace(/{{endTime}}/g, endTime)
          .replace(/{{trialDate}}/g, trialDate)
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

        if (sendResult.status) {
          sentTo.push(parent.parentEmail);
        }
      }
    }

    return {
      status: true,
      message: `Cancel Free Trial emails sent to ${sentTo.length} parents`,
      sentTo,
    };
  } catch (error) {
    console.error("❌ sendCancelBookingEmailToParents Error:", error);
    return { status: false, message: error.message };
  }
};

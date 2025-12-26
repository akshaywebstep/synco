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
// const cancelContract = require("../../../utils/payment/accessPaysuit/accesPaySuit");

const { Op } = require("sequelize");

// exports.createCancelBooking = async ({
//   bookingId,
//   cancelReason,
//   additionalNote,
//   cancelDate = null,
//   cancellationType: rawCancellationType,
// }) => {
//   try {
//     const bookingType = "membership";

//     DEBUG && console.log("🚀 Cancel membership started:", bookingId);

//     // --------------------------------------------------
//     // 1️⃣ Existing logic (UNCHANGED)
//     // --------------------------------------------------
//     const booking = await Booking.findByPk(bookingId);
//     if (!booking) return { status: false, message: "Booking not found." };

//     const existingCancel = await CancelBooking.findOne({
//       where: { bookingId, bookingType },
//     });

//     const cancellationType =
//       rawCancellationType ?? (cancelDate ? "scheduled" : "immediate");

//     const restoreClassCapacity = async () => {
//       const studentMetaList = await BookingStudentMeta.findAll({
//         where: { bookingTrialId: bookingId },
//       });

//       if (!studentMetaList.length || !booking.classScheduleId) return;

//       const classSchedule = await ClassSchedule.findByPk(
//         booking.classScheduleId
//       );

//       if (!classSchedule) return;

//       await classSchedule.update({
//         capacity: classSchedule.capacity + studentMetaList.length,
//       });
//     };

//     if (existingCancel) {
//       await existingCancel.update({
//         cancelReason: cancelReason ?? existingCancel.cancelReason,
//         additionalNote: additionalNote ?? existingCancel.additionalNote,
//         cancelDate: cancelDate ?? existingCancel.cancelDate,
//         cancellationType,
//         updatedAt: new Date(),
//       });
//     } else {
//       await CancelBooking.create({
//         bookingId,
//         bookingType,
//         cancelReason: cancelReason || null,
//         additionalNote: additionalNote || null,
//         cancelDate: cancelDate || null,
//         cancellationType,
//       });
//     }

//     if (cancellationType === "immediate") {
//       await booking.update({ status: "cancelled" });
//       await restoreClassCapacity();
//     } else {
//       await booking.update({ status: "request_to_cancel" });
//     }

//     // --------------------------------------------------
//     // 2️⃣ ADD-ON LOGIC STARTS HERE
//     // --------------------------------------------------
//     if (cancellationType === "immediate" || cancellationType === "scheduled") {
//       DEBUG && console.log(`💳 Processing payment cancellation for type: ${cancellationType}`);

//       const payment = await BookingPayment.findOne({
//         where: { bookingId },
//       });

//       if (!payment) {
//         DEBUG && console.log("⚠️ No payment found → skipping gateway & credits");
//       } else {
//         DEBUG && console.log("💰 Payment type detected:", payment.paymentType);

//         let paymentCancelled = false;

//         if (payment.paymentType === "accesspaysuite") {
//           DEBUG && console.log("🌐 Cancelling APS contract:", payment.contractId);

//           const apsResponse = await cancelContract(
//             payment.contractId,
//             {
//               reason: cancelReason || "Membership cancelled",
//             }
//           );

//           if (apsResponse?.status === true) {
//             paymentCancelled = true;
//             DEBUG && console.log("✅ APS contract cancelled successfully");

//             await payment.update({ status: "cancelled" });
//             DEBUG && console.log("✅ Payment status updated to cancelled");
//           } else {
//             DEBUG && console.error("❌ APS cancellation failed:", apsResponse);
//           }
//         }

//         if (payment.paymentType === "bank") {
//           DEBUG && console.log("🏦 Bank payment detected (integration pending)");
         
//         }

//         if (paymentCancelled) {
//           DEBUG && console.log("💳 Issuing credits...");

//           await Credit.findOrCreate({
//             where: { bookingId },
//             defaults: {
//               bookingId,
//               creditAmount: booking.remainingCredits ?? 0,
//               reason: "auto",
//             },
//           });

//           DEBUG && console.log("✅ Credits issued successfully");
//         } else {
//           DEBUG && console.log("⛔ Credits NOT issued because payment not cancelled");
//         }
//       }
//     }

//     // --------------------------------------------------
//     // 4️⃣ Final response
//     // --------------------------------------------------
//     return {
//       status: true,
//       message:
//         cancellationType === "immediate"
//           ? "Membership booking cancelled."
//           : `Membership booking cancellation scheduled for ${cancelDate}.`,
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
  cancelDate = null, 
  cancellationType: rawCancellationType
}) => {
  try {
    const bookingType = "membership";

    // Validate booking exists
    const booking = await Booking.findByPk(bookingId);
    if (!booking) return { status: false, message: "Booking not found." };

    // Check existing cancel record
    const existingCancel = await CancelBooking.findOne({
      where: { bookingId, bookingType },
    });

    const cancellationType =
      rawCancellationType ?? (cancelDate ? "scheduled" : "immediate");

    // Function — Restore class capacity based on used student count
    const restoreClassCapacity = async () => {
      const studentMetaList = await BookingStudentMeta.findAll({
        where: { bookingTrialId: bookingId },
      });

      if (studentMetaList.length === 0 || !booking.classScheduleId) return;

      const classSchedule = await ClassSchedule.findByPk(
        booking.classScheduleId
      );

      if (!classSchedule) return;

      await classSchedule.update({
        capacity: classSchedule.capacity + studentMetaList.length,
      });
    };

    // If record exists → update
    if (existingCancel) {
      await existingCancel.update({
        cancelReason: cancelReason ?? existingCancel.cancelReason,
        additionalNote: additionalNote ?? existingCancel.additionalNote,
        cancelDate: cancelDate ?? existingCancel.cancelDate,
        cancellationType,
         updatedAt: new Date(),
      });

      if (cancellationType === "immediate") {
        await booking.update({ status: "cancelled" });
        await restoreClassCapacity();
      } else {
        await booking.update({ status: "request_to_cancel" });
      }

      return {
        status: true,
        message: "Existing cancellation updated successfully.",
        data: { cancelRequest: existingCancel, bookingDetails: booking },
      };
    }

    // Otherwise → create a new cancellation entry
    const cancelRequest = await CancelBooking.create({
      bookingId,
      bookingType,
      cancelReason: cancelReason || null,
      additionalNote: additionalNote || null,
      cancelDate: cancelDate || null,
      cancellationType,
    });

    if (cancellationType === "immediate") {
      await booking.update({ status: "cancelled" });
      await restoreClassCapacity();
    } else {
      await booking.update({ status: "request_to_cancel" });
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

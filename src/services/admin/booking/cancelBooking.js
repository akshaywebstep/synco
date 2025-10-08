const {
  CancelBooking,
  Booking,
  BookingStudentMeta,
  BookingParentMeta,
  Venue,
  ClassSchedule,
} = require("../../../models");
const { getEmailConfig } = require("../../email");
const sendEmail = require("../../../utils/email/sendEmail");

// ✅ Create a cancellation for a free trial booking
// exports.createCancelBooking = async ({
//   bookingId,
//   cancelReason,
//   additionalNote,
// }) => {
//   try {
//     const bookingType = "free"; // fixed for free trial

//     // ✅ Validate booking exists
//     const booking = await Booking.findByPk(bookingId);
//     if (!booking) {
//       return { status: false, message: "Booking not found." };
//     }

//     // ❗ Prevent duplicate cancellation for this free trial
//     const existingCancel = await CancelBooking.findOne({
//       where: { bookingId, bookingType },
//     });

//     if (existingCancel) {
//       return {
//         status: false,
//         message: "Cancellation already recorded for this free trial booking.",
//       };
//     }

//     // ✅ Record cancellation
//     const cancelRequest = await CancelBooking.create({
//       bookingId,
//       bookingType,
//       cancelReason: cancelReason || null,
//       additionalNote: additionalNote || null,
//     });

//     // ✅ Update booking status to cancelled immediately
//     await booking.update({ status: "cancelled" });

//     return {
//       status: true,
//       message: "Free trial booking cancelled successfully.",
//       data: { cancelRequest, bookingDetails: booking },
//     };
//   } catch (error) {
//     console.error("❌ createCancelBooking Error:", error);
//     return { status: false, message: error.message };
//   }
// };

exports.createCancelBooking = async ({ bookingId, cancelReason, additionalNote }) => {
  try {
    const bookingType = "free"; // fixed for free trial

    // Validate booking exists
    const booking = await Booking.findByPk(bookingId);
    if (!booking) {
      return { status: false, message: "Booking not found." };
    }

    // Prevent duplicate cancellation
    const existingCancel = await CancelBooking.findOne({
      where: { bookingId, bookingType },
    });
    if (existingCancel) {
      return {
        status: false,
        message: "Cancellation already recorded for this free trial booking.",
      };
    }

    // Record cancellation
    const cancelRequest = await CancelBooking.create({
      bookingId,
      bookingType,
      cancelReason: cancelReason || null,
      additionalNote: additionalNote || null,
    });

    // Update booking status to cancelled
    await booking.update({ status: "cancelled" });

    // ✅ Update class schedule capacity based on linked students
    const studentMetaList = await BookingStudentMeta.findAll({
      where: { bookingTrialId: bookingId },
    });

    if (studentMetaList.length > 0) {
      // Assuming booking has a classScheduleId
      const classSchedule = await ClassSchedule.findByPk(booking.classScheduleId);

      if (classSchedule) {
        // Increase capacity by the number of students linked to this booking
        const incrementCapacity = studentMetaList.length;
        await classSchedule.update({
          capacity: classSchedule.capacity + incrementCapacity,
        });
      }
    }

    return {
      status: true,
      message: "Free trial booking cancelled successfully.",
      data: { cancelRequest, bookingDetails: booking },
    };
  } catch (error) {
    console.error("❌ createCancelBooking Error:", error);
    return { status: false, message: error.message };
  }
};

// ✅ Fetch all free trial cancellations
exports.getCancelBookings = async () => {
  try {
    const cancellations = await CancelBooking.findAll({
      where: { bookingType: "free" }, // only free trials
      include: [
        {
          model: Booking,
          as: "booking",
          attributes: [
            "id",
            "venueId",
            "classScheduleId",
            "trialDate",
            "status",
            "bookedBy",
          ],
          include: [
            {
              model: BookingStudentMeta,
              as: "students",
              attributes: [
                "id",
                "studentFirstName",
                "studentLastName",
                "dateOfBirth",
                "age",
                "gender",
                "medicalInformation",
              ],
            },
          ],
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    return { status: true, data: cancellations };
  } catch (error) {
    console.error("❌ getCancelBookings Error:", error);
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
//  for single parent to send email code
// exports.sendCancelBookingEmailToParents = async ({ bookingId }) => {
//   try {
//     const booking = await Booking.findByPk(bookingId);
//     if (!booking) {
//       return { status: false, message: "Booking not found" };
//     }

//     const studentMetas = await BookingStudentMeta.findAll({
//       where: { bookingTrialId: bookingId },
//     });

//     if (!studentMetas.length) {
//       return { status: false, message: "No students found for this booking" };
//     }

//     const venue = await Venue.findByPk(booking.venueId);
//     const classSchedule = await ClassSchedule.findByPk(booking.classScheduleId);

//     const venueName = venue?.venueName || "Unknown Venue";
//     const className = classSchedule?.className || "Unknown Class";
//     const startTime = classSchedule?.startTime || "TBA";
//     const endTime = classSchedule?.endTime || "TBA";
//     const trialDate = booking.trialDate;
//     const additionalNote = booking.additionalNote || "";

//     const emailConfigResult = await getEmailConfig(
//       "admin",
//       "cancel-free-trial"
//     );
//     if (!emailConfigResult.status) {
//       return { status: false, message: "Email config missing" };
//     }

//     const { emailConfig, htmlTemplate, subject } = emailConfigResult;
//     let sentTo = [];

//     for (const student of studentMetas) {
//       const parents = await BookingParentMeta.findAll({
//         where: { studentId: student.id },
//       });

//       if (!parents.length) continue;

//       const primaryParent = parents[0];
//       if (!primaryParent?.parentEmail) continue;

//       let noteHtml = "";
//       if (additionalNote.trim() !== "") {
//         noteHtml = `<p><strong>Additional Note:</strong> ${additionalNote}</p>`;
//       }

//       let finalHtml = htmlTemplate
//         .replace(/{{parentName}}/g, primaryParent.parentFirstName)
//         .replace(/{{studentName}}/g, student.studentFirstName)
//         .replace(/{{venueName}}/g, venueName)
//         .replace(/{{className}}/g, className)
//         .replace(/{{startTime}}/g, startTime)
//         .replace(/{{endTime}}/g, endTime)
//         .replace(/{{trialDate}}/g, trialDate)
//         .replace(/{{additionalNoteSection}}/g, noteHtml)
//         .replace(/{{appName}}/g, "Synco")
//         .replace(/{{year}}/g, new Date().getFullYear());

//       const recipient = [
//         {
//           name: `${primaryParent.parentFirstName} ${primaryParent.parentLastName}`,
//           email: primaryParent.parentEmail,
//         },
//       ];

//       const sendResult = await sendEmail(emailConfig, {
//         recipient,
//         subject,
//         htmlBody: finalHtml,
//       });

//       if (sendResult.status) {
//         sentTo.push(primaryParent.parentEmail);
//       }
//     }

//     return {
//       status: true,
//       message: `Cancel Free Trial emails sent to ${sentTo.length} parents`,
//       sentTo,
//     };
//   } catch (error) {
//     console.error("❌ sendCancelBookingEmailToParents Error:", error);
//     return { status: false, message: error.message };
//   }
// };

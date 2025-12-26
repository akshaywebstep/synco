const express = require("express");
const router = express.Router();
const authMiddleware = require("../../middleware/admin/authenticate");
const permissionMiddleware = require("../../middleware/admin/permission");

const {
  createCancelBooking,
  getCancelBookings,
  sendCancelBookingEmail,
  // createNoMembership,
} = require("../../controllers/admin/booking/cancelMembershipBookingController");

router.post(
  "/",
  authMiddleware,
  permissionMiddleware("cancel-membership", "create"),
  createCancelBooking
);

router.post(
  "/send-email",
  authMiddleware,
  permissionMiddleware("cancel-membership", "view-listing"),
  sendCancelBookingEmail
);

module.exports = router;

// exports.createCancelBooking = async ({
//   bookingId,
//   cancelReason,
//   additionalNote,
//   cancelDate = null, 
//   cancellationType: rawCancellationType
// }) => {
//   try {
//     const bookingType = "membership";

//     // Validate booking exists
//     const booking = await Booking.findByPk(bookingId);
//     if (!booking) return { status: false, message: "Booking not found." };

//     // Check existing cancel record
//     const existingCancel = await CancelBooking.findOne({
//       where: { bookingId, bookingType },
//     });

//     const cancellationType =
//       rawCancellationType ?? (cancelDate ? "scheduled" : "immediate");

//     // Function — Restore class capacity based on used student count
//     const restoreClassCapacity = async () => {
//       const studentMetaList = await BookingStudentMeta.findAll({
//         where: { bookingTrialId: bookingId },
//       });

//       if (studentMetaList.length === 0 || !booking.classScheduleId) return;

//       const classSchedule = await ClassSchedule.findByPk(
//         booking.classScheduleId
//       );

//       if (!classSchedule) return;

//       await classSchedule.update({
//         capacity: classSchedule.capacity + studentMetaList.length,
//       });
//     };

//     // If record exists → update
//     if (existingCancel) {
//       await existingCancel.update({
//         cancelReason: cancelReason ?? existingCancel.cancelReason,
//         additionalNote: additionalNote ?? existingCancel.additionalNote,
//         cancelDate: cancelDate ?? existingCancel.cancelDate,
//         cancellationType,
//          updatedAt: new Date(),
//       });

//       if (cancellationType === "immediate") {
//         await booking.update({ status: "cancelled" });
//         await restoreClassCapacity();
//       } else {
//         await booking.update({ status: "request_to_cancel" });
//       }

//       return {
//         status: true,
//         message: "Existing cancellation updated successfully.",
//         data: { cancelRequest: existingCancel, bookingDetails: booking },
//       };
//     }

//     // Otherwise → create a new cancellation entry
//     const cancelRequest = await CancelBooking.create({
//       bookingId,
//       bookingType,
//       cancelReason: cancelReason || null,
//       additionalNote: additionalNote || null,
//       cancelDate: cancelDate || null,
//       cancellationType,
//     });

//     if (cancellationType === "immediate") {
//       await booking.update({ status: "cancelled" });
//       await restoreClassCapacity();
//     } else {
//       await booking.update({ status: "request_to_cancel" });
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
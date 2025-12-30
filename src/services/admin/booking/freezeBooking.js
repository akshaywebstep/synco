// const { sequelize, Booking, FreezeBooking } = require("../../../models");
const {
  sequelize,
  FreezeBooking,
  Booking,
  BookingStudentMeta,
  BookingParentMeta,
  BookingEmergencyMeta,
  BookingPayment,
  Venue,
  ClassSchedule,
  PaymentPlan,
  WaitingList,
  CancelBooking,
} = require("../../../models");
const { Op } = require("sequelize");

const { freezeContract, reactivateContract } = require("../../../utils/payment/accessPaySuit/accesPaySuit");
const DEBUG = process.env.DEBUG === "true";

exports.createFreezeBooking = async ({
  bookingId,
  freezeStartDate,
  freezeDurationMonths,
  reasonForFreezing,
}) => {
  const t = await sequelize.transaction();

  try {
    // 🔹 1. Validate booking
    const booking = await Booking.findByPk(bookingId, { transaction: t });
    if (!booking) {
      await t.rollback();
      return { status: false, message: "Booking not found." };
    }

    // 🔹 2. Fetch payment info
    const bookingPayment = await BookingPayment.findOne({
      where: { bookingId },
      transaction: t,
    });

    if (!bookingPayment) {
      await t.rollback();
      return { status: false, message: "Booking payment not found." };
    }

    if (DEBUG) {
      console.log("📌 Booking payment type:", bookingPayment.paymentType);
    }

    // 🔹 3. Calculate reactivation date
    const reactivateOn = new Date(freezeStartDate);
    reactivateOn.setMonth(
      reactivateOn.getMonth() + Number(freezeDurationMonths)
    );

    // 🔹 4. Prevent duplicate active freeze
    const existingFreeze = await FreezeBooking.findOne({
      where: {
        bookingId,
        reactivateOn: { [Op.gte]: new Date() },
      },
      transaction: t,
    });

    if (existingFreeze) {
      await t.rollback();
      return {
        status: false,
        message: "Booking is already under a freeze period.",
      };
    }

    // 🔹 5. Freeze in Access PaySuite (ONLY if APS)
    if (bookingPayment.paymentType === "accesspaysuite") {
      let gatewayResponse = bookingPayment.gatewayResponse;

      if (typeof gatewayResponse === "string") {
        gatewayResponse = JSON.parse(gatewayResponse);
      }

      // ✅ Resolve contractId correctly
      const contractId =
        bookingPayment.contractId ||
        gatewayResponse?.contract?.Id ||
        gatewayResponse?.contract?.id;

      if (!contractId) {
        await t.rollback();
        return {
          status: false,
          message: "APS contract ID missing for this booking.",
        };
      }

      if (DEBUG) {
        console.log("🔒 Freezing APS contract:", contractId);
      }

      const apsFreezeResponse = await freezeContract(contractId, {
        from: freezeStartDate,
        to: reactivateOn,
        comment: reasonForFreezing || "Membership freeze",
      });

      if (!apsFreezeResponse?.status) {
        await t.rollback();
        return {
          status: false,
          message:
            apsFreezeResponse?.message ||
            "Failed to freeze membership in Access PaySuite.",
        };
      }

      if (DEBUG) {
        console.log("✅ APS freeze successful for contract:", contractId);
      }
    }

    // 🔹 6. Create FreezeBooking record
    const freezeRecord = await FreezeBooking.create(
      {
        bookingId,
        freezeStartDate,
        freezeDurationMonths,
        reactivateOn,
        reasonForFreezing: reasonForFreezing || null,
      },
      { transaction: t }
    );

    // 🔹 7. (Optional) Update booking status
    // await booking.update({ status: "frozen" }, { transaction: t });

    await t.commit();

    return {
      status: true,
      message: "Booking frozen successfully.",
      data: {
        freezeRecord,
        bookingDetails: booking,
      },
    };
  } catch (error) {
    await t.rollback();
    console.error("❌ createFreezeBooking Error:", error);
    return { status: false, message: error.message };
  }
};

exports.reactivateBooking = async (bookingId, reactivateOn = null, additionalNote = null) => {
  const t = await sequelize.transaction();

  try {
    // --------------------------------------------------
    // 1. Fetch freeze record (if any)
    // --------------------------------------------------
    const freezeRecord = await FreezeBooking.findOne({
      where: {
        bookingId,
        reactivateOn: { [Op.gte]: new Date() },
      },
      transaction: t,
    });

    // --------------------------------------------------
    // 2. Fetch booking + payment
    // --------------------------------------------------
    const booking = await Booking.findByPk(bookingId, {
      transaction: t,
      include: [{ model: BookingPayment, as: "payments" }],
    });

    if (!booking) {
      await t.rollback();
      return { status: false, message: "Booking not found." };
    }

    const bookingPayment = booking.payments?.[0];
    if (!bookingPayment) {
      await t.rollback();
      return { status: false, message: "Booking payment not found." };
    }

    // --------------------------------------------------
    // 3. Student count (capacity logic)
    // --------------------------------------------------
    const studentCount = await BookingStudentMeta.count({
      where: { bookingTrialId: bookingId },
      transaction: t,
    });

    if (studentCount === 0) {
      await t.rollback();
      return { status: false, message: "No students found for this booking." };
    }

    const wasCancelled = booking.status === "cancelled";
    const wasFrozen = booking.status === "frozen";
    const paymentType = bookingPayment.paymentType;

    // --------------------------------------------------
    // 4. Parse gateway response safely
    // --------------------------------------------------
    let gatewayResponse = bookingPayment.gatewayResponse;
    if (typeof gatewayResponse === "string") {
      try {
        gatewayResponse = JSON.parse(gatewayResponse);
      } catch {
        gatewayResponse = {};
      }
    }

    const contractId =
      bookingPayment.contractId ||
      gatewayResponse?.contract?.Id ||
      gatewayResponse?.contract?.id ||
      gatewayResponse?.contractId ||
      gatewayResponse?.contract_id ||
      null;

    // --------------------------------------------------
    // 5. Capacity check (ONLY for cancelled)
    // --------------------------------------------------
    if (wasCancelled) {
      const classSchedule = await ClassSchedule.findByPk(
        booking.classScheduleId,
        { transaction: t, lock: t.LOCK.UPDATE }
      );

      if (!classSchedule || classSchedule.capacity < studentCount) {
        await t.rollback();
        return {
          status: false,
          message: "Insufficient capacity to reactivate booking.",
        };
      }

      await classSchedule.decrement("capacity", {
        by: studentCount,
        transaction: t,
      });
    }

    // ==================================================
    // 6. ACCESSPAYSUITE REACTIVATION
    // ==================================================
    if (paymentType === "accesspaysuite") {
      if (!contractId) {
        await t.rollback();
        return { status: false, message: "Contract ID not found." };
      }

      const apsResult = await reactivateContract(contractId, {
        reactivateOn,
        note: additionalNote || "",
      });

      if (!apsResult.status) {
        await t.rollback();
        return { status: false, message: apsResult.message };
      }

      await bookingPayment.update(
        {
          paymentStatus: "active",
          gatewayResponse: JSON.stringify({
            ...(typeof gatewayResponse === "object" ? gatewayResponse : {}),
            apsReactivatedAt: new Date().toISOString(),
            apsResponse: apsResult.data || null,
          }),
        },
        { transaction: t }
      );
    }

    // ==================================================
    // 7. BANK / MANUAL REACTIVATION
    // ==================================================
    else {
      let transactionMeta = bookingPayment.transactionMeta;
      if (typeof transactionMeta === "string") {
        try {
          transactionMeta = JSON.parse(transactionMeta);
        } catch {
          transactionMeta = {};
        }
      }

      await bookingPayment.update(
        {
          paymentStatus: "active",
          transactionMeta: JSON.stringify({
            ...(typeof transactionMeta === "object" ? transactionMeta : {}),
            reactivatedAt: new Date().toISOString(),
            reactivatedBy: "admin",
          }),
        },
        { transaction: t }
      );
    }

    // --------------------------------------------------
    // 8. Update booking
    // --------------------------------------------------
    await booking.update(
      {
        status: "active",
        additionalNote: additionalNote || null,
      },
      { transaction: t }
    );

    // --------------------------------------------------
    // 9. Cleanup auxiliary tables
    // --------------------------------------------------
    if (wasCancelled) {
      await CancelBooking.destroy({
        where: { bookingId, bookingType: "membership" },
        transaction: t,
      });
    }

    if (wasFrozen && freezeRecord) {
      await freezeRecord.destroy({ transaction: t });
    }

    // --------------------------------------------------
    // 10. Commit
    // --------------------------------------------------
    await t.commit();

    // --------------------------------------------------
    // 11. Return updated booking
    // --------------------------------------------------
    const updatedBooking = await Booking.findByPk(bookingId, {
      include: [
        {
          model: ClassSchedule,
          as: "classSchedule",
          include: [{ model: Venue, as: "venue" }],
        },
        {
          model: BookingStudentMeta,
          as: "students",
          include: [
            { model: BookingParentMeta, as: "parents" },
            { model: BookingEmergencyMeta, as: "emergencyContacts" },
          ],
        },
      ],
    });

    return {
      status: true,
      message: "Booking reactivated successfully.",
      data: updatedBooking,
    };
  } catch (error) {
    await t.rollback();
    console.error("❌ reactivateBooking Error:", error);
    return { status: false, message: error.message };
  }
};

// exports.reactivateBooking = async (bookingId, reactivateOn = null, additionalNote = null) => {
//   const t = await sequelize.transaction();
//   try {
//     // 1. Find active freeze record
//     const freezeRecord = await FreezeBooking.findOne({
//       where: {
//         bookingId,
//         reactivateOn: { [Op.gte]: new Date() },
//       },
//       transaction: t,
//     });

//     // 2. Fetch booking + payment
//     const booking = await Booking.findByPk(bookingId, {
//       transaction: t,
//       include: [{ model: BookingPayment, as: "payments" }],
//     });

//     if (!booking) {
//       await t.rollback();
//       return { status: false, message: "Booking not found." };
//     }

//     const bookingPayment = booking.payments?.[0];
//     if (!bookingPayment) {
//       await t.rollback();
//       return { status: false, message: "Booking payment not found." };
//     }

//     // 3. Count students for capacity handling
//     const studentCount = await BookingStudentMeta.count({
//       where: { bookingTrialId: bookingId },
//       transaction: t,
//     });

//     if (studentCount === 0) {
//       await t.rollback();
//       return { status: false, message: "No students found for this booking." };
//     }

//     const paymentType = bookingPayment.paymentType;

//     // 4. Parse gateway response safely
//     let gatewayResponse = bookingPayment.gatewayResponse;
//     if (typeof gatewayResponse === "string") {
//       try {
//         gatewayResponse = JSON.parse(gatewayResponse);
//       } catch {
//         gatewayResponse = {};
//       }
//     }

//     const contractId =
//       bookingPayment.contractId ||
//       gatewayResponse?.contract?.Id ||
//       gatewayResponse?.contract?.id ||
//       gatewayResponse?.contractId ||
//       gatewayResponse?.contract_id ||
//       null;

//     /**
//      * =========================================================
//      * APS PAYMENT REACTIVATION
//      * =========================================================
//      */
//     if (paymentType === "accesspaysuite") {
//       if (!contractId) {
//         await t.rollback();
//         return { status: false, message: "Contract ID not found." };
//       }

//       const apsResult = await reactivateContract(contractId, {
//         reactivateOn,
//         note: additionalNote || "",
//       });

//       if (!apsResult.status) {
//         await t.rollback();
//         return { status: false, message: apsResult.message || "APS reactivation failed." };
//       }

//       // Capacity handling for cancelled bookings
//       if (booking.status === "cancelled") {
//         const classSchedule = await ClassSchedule.findByPk(
//           booking.classScheduleId,
//           { transaction: t, lock: t.LOCK.UPDATE }
//         );

//         if (!classSchedule || classSchedule.capacity < studentCount) {
//           await t.rollback();
//           return {
//             status: false,
//             message: "Insufficient capacity to reactivate booking.",
//           };
//         }

//         await classSchedule.decrement("capacity", {
//           by: studentCount,
//           transaction: t,
//         });
//       }

//       await booking.update(
//         { status: "active", additionalNote: additionalNote || null },
//         { transaction: t }
//       );

//       if (freezeRecord) {
//         await freezeRecord.destroy({ transaction: t });
//       }

//       await t.commit();
//     }

//     /**
//      * =========================================================
//      * NON-APS (BANK / MANUAL) REACTIVATION
//      * =========================================================
//      */
//     else {
//       if (booking.status === "cancelled") {
//         const classSchedule = await ClassSchedule.findByPk(
//           booking.classScheduleId,
//           { transaction: t, lock: t.LOCK.UPDATE }
//         );

//         if (!classSchedule) {
//           await t.rollback();
//           return { status: false, message: "Class schedule not found." };
//         }

//         if (classSchedule.capacity < studentCount) {
//           await t.rollback();
//           return {
//             status: false,
//             message: `Only ${classSchedule.capacity} seats available, ${studentCount} required.`,
//           };
//         }

//         await classSchedule.decrement("capacity", {
//           by: studentCount,
//           transaction: t,
//         });
//       }

//       await booking.update(
//         {
//           status: "active",
//           additionalNote: additionalNote || null,
//           ...(reactivateOn && { reactivateOn }),
//         },
//         { transaction: t }
//       );

//       if (freezeRecord) {
//         await freezeRecord.destroy({ transaction: t });
//       }

//       await t.commit();
//     }

//     // 5. Return updated booking
//     const updatedBooking = await Booking.findByPk(bookingId, {
//       include: [
//         {
//           model: ClassSchedule,
//           as: "classSchedule",
//           include: [{ model: Venue, as: "venue" }],
//         },
//         {
//           model: BookingStudentMeta,
//           as: "students",
//           include: [
//             { model: BookingParentMeta, as: "parents" },
//             { model: BookingEmergencyMeta, as: "emergencyContacts" },
//           ],
//         },
//       ],
//     });

//     return {
//       status: true,
//       message: "Booking reactivated successfully.",
//       data: updatedBooking,
//     };
//   } catch (error) {
//     await t.rollback();
//     console.error("❌ reactivateBooking Error:", error);
//     return { status: false, message: error.message };
//   }
// };

// exports.createFreezeBooking = async ({
//   bookingId,
//   freezeStartDate,
//   freezeDurationMonths,
//   reasonForFreezing,
// }) => {
//   const t = await sequelize.transaction();
//   try {
//     // 🔹 1. Validate booking
//     const booking = await Booking.findByPk(bookingId, { transaction: t });
//     if (!booking) {
//       await t.rollback();
//       return { status: false, message: "Booking not found." };
//     }

//     // 🔹 2. Calculate reactivation date
//     const reactivateOn = new Date(freezeStartDate);
//     reactivateOn.setMonth(reactivateOn.getMonth() + freezeDurationMonths);

//     // 🔹 3. Prevent duplicate active freeze
//     const existingFreeze = await FreezeBooking.findOne({
//       where: {
//         bookingId,
//         reactivateOn: { [Op.gte]: new Date() }, // still active
//       },
//       transaction: t,
//     });

//     if (existingFreeze) {
//       await t.rollback();
//       return {
//         status: false,
//         message: "Booking is already under a freeze period.",
//       };
//     }

//     // 🔹 4. Create FreezeBooking record
//     const freezeRecord = await FreezeBooking.create(
//       {
//         bookingId,
//         freezeStartDate,
//         freezeDurationMonths,
//         reactivateOn,
//         reasonForFreezing: reasonForFreezing || null,
//       },
//       { transaction: t }
//     );

//     // 🔹 5. Update booking status
//     // await booking.update({ status: "frozen" }, { transaction: t });

//     await t.commit();
//     return {
//       status: true,
//       message: "Booking frozen successfully.",
//       data: { freezeRecord, bookingDetails: booking },
//     };
//   } catch (error) {
//     await t.rollback();
//     console.error("❌ createFreezeBooking Error:", error);
//     return { status: false, message: error.message };
//   }
// };

exports.listFreezeBookings = async (whereVenue = {}) => {
  const t = await sequelize.transaction();
  try {
    const freezeBookings = await FreezeBooking.findAll({
      include: [
        {
          model: Booking,
          as: "booking",
          include: [
            // ✅ ClassSchedule with Venue inside
            {
              model: ClassSchedule,
              as: "classSchedule",
              required: true,
              include: [
                {
                  model: Venue,
                  as: "venue",
                  where: whereVenue,
                  required: true,
                },
              ],
            },
            // ✅ Students with parents and emergency contacts
            {
              model: BookingStudentMeta,
              as: "students",
              include: [
                { model: BookingParentMeta, as: "parents" },
                { model: BookingEmergencyMeta, as: "emergencyContacts" },
              ],
            },
          ],
        },
      ],
      order: [["freezeStartDate", "DESC"]],
      transaction: t,
    });

    await t.commit();
    return {
      status: true,
      message: "Freeze bookings fetched successfully.",
      data: freezeBookings,
    };
  } catch (error) {
    await t.rollback();
    console.error("❌ listFreezeBookings Error:", error);
    return { status: false, message: error.message };
  }
};

// exports.reactivateBooking = async (
//   bookingId,
//   reactivateOn = null,
//   additionalNote = null
// ) => {
//   const t = await sequelize.transaction();
//   try {
//     // 🔹 1. Try to find active freeze record
//     let freezeRecord = await FreezeBooking.findOne({
//       where: {
//         bookingId,
//         reactivateOn: { [Op.gte]: new Date() },
//       },
//       transaction: t,
//     });

//     // 🔹 2. Fetch booking
//     const booking = await Booking.findByPk(bookingId, { transaction: t });
//     if (!booking) {
//       await t.rollback();
//       return { status: false, message: "Booking not found." };
//     }

//     if (!freezeRecord && !["frozen", "cancelled"].includes(booking.status)) {
//       await t.rollback();
//       return {
//         status: false,
//         message: "No active freeze or cancelled booking found for this booking.",
//       };
//     }
//     // 🔹 3B. If booking is cancelled, check class capacity before reactivating
//     if (booking.status === "cancelled") {
//       const classSchedule = await ClassSchedule.findByPk(booking.classScheduleId, {
//         transaction: t,
//       });

//       if (!classSchedule) {
//         await t.rollback();
//         return { status: false, message: "Class schedule not found." };
//       }

//       // If class capacity is zero → no space at all
//       if (classSchedule.capacity === 0) {
//         await t.rollback();
//         return {
//           status: false,
//           message: "This class has no available capacity.",
//         };
//       }

//       // List of statuses that count toward class capacity
//       const capacityStatuses = ["pending", "active", "attended", "frozen"];

//       // Count BOOKINGS that occupy a spot (exclude cancelled)
//       const usedCapacityCount = await Booking.count({
//         where: {
//           classScheduleId: booking.classScheduleId,
//           status: capacityStatuses,
//         },
//         transaction: t,
//       });

//       // If class is full → stop reactivation
//       if (usedCapacityCount >= classSchedule.capacity) {
//         await t.rollback();
//         return {
//           status: false,
//           message: "Class is already full. No capacity available.",
//         };
//       }
//     }

//     // 🔹 4. Prepare update data
//     const updatedData = {
//       status: "active",
//       additionalNote: additionalNote, // always update
//     };

//     // Update reactivate date if provided
//     if (reactivateOn) updatedData.reactivateOn = reactivateOn;

//     await booking.update(updatedData, { transaction: t });

//     // 🔹 5. Delete freeze record if it exists
//     if (freezeRecord) {
//       await freezeRecord.destroy({ transaction: t });
//     }

//     // 🔹 6. Fetch full updated booking with nested data
//     const updatedBooking = await Booking.findByPk(bookingId, {
//       include: [
//         {
//           model: ClassSchedule,
//           as: "classSchedule",
//           required: true,
//           include: [{ model: Venue, as: "venue" }],
//         },
//         {
//           model: BookingStudentMeta,
//           as: "students",
//           include: [
//             { model: BookingParentMeta, as: "parents" },
//             { model: BookingEmergencyMeta, as: "emergencyContacts" },
//           ],
//         },
//       ],
//       transaction: t,
//     });

//     await t.commit();

//     return {
//       status: true,
//       message: "Booking reactivated successfully.",
//       data: updatedBooking,
//     };
//   } catch (error) {
//     await t.rollback();
//     console.error("❌ reactivateBooking Service Error:", error);
//     return { status: false, message: error.message };
//   }
// };

exports.cancelWaitingListSpot = async ({
  bookingId,
  reasonForCancelling = null,
  additionalNote = null,
}) => {
  const t = await sequelize.transaction();
  try {
    // 🔹 1. Find booking
    const booking = await Booking.findByPk(bookingId, { transaction: t });

    if (!booking) {
      await t.rollback();
      return { status: false, message: "Booking not found." };
    }

    // 🔹 2. Update booking status to "cancelled"
    await booking.update({ status: "cancelled" }, { transaction: t });

    // 🔹 3. Update or Insert into CancelBooking table
    const existingCancel = await CancelBooking.findOne({
      where: { bookingId },
      transaction: t,
    });

    if (existingCancel) {
      await existingCancel.update(
        {
          reasonForCancelling,
          additionalNote,
          bookingType: "membership", // static value
        },
        { transaction: t }
      );
    } else {
      await CancelBooking.create(
        {
          bookingId,
          reasonForCancelling,
          additionalNote,
          bookingType: "membership", // static value
        },
        { transaction: t }
      );
    }

    await t.commit();
    return {
      status: true,
      message: "Booking marked as cancelled.",
      data: { bookingId, status: "cancelled" },
    };
  } catch (error) {
    await t.rollback();
    console.error("❌ cancelWaitingListSpot Error:", error);
    return { status: false, message: error.message };
  }
};

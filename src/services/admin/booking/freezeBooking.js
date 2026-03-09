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
const { pauseGoCardlessSubscription, resumeGoCardlessSubscription } = require("../../../utils/payment/pay360/customer");
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
      where: {
        bookingId,
        paymentCategory: {
          [Op.in]: ["recurring", "one_off"]
        }
      },
      transaction: t,
    });
    if (!bookingPayment) {
      await t.rollback();
      return {
        status: false,
        message: "Payment record not found for this booking.",
      };
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
        reactivateOn: {
          [Op.gte]: new Date(freezeStartDate)
        }
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
    if (bookingPayment.paymentCategory === "recurring") {

      if (bookingPayment.paymentType === "accesspaysuite") {

        let gatewayResponse = bookingPayment.gatewayResponse;

        // Parse gatewayResponse safely
        try {
          if (typeof gatewayResponse === "string") {
            gatewayResponse = JSON.parse(gatewayResponse);
          }
        } catch (err) {
          console.warn("⚠️ gatewayResponse parse failed:", err);
        }

        // Resolve contractId
        const contractId =
          bookingPayment.contractId ||
          gatewayResponse?.contract?.Id ||
          gatewayResponse?.contract?.id;

        if (!contractId) {
          await t.rollback();
          return {
            status: false,
            message: "AccessPaySuite contract ID missing.",
          };
        }

        if (DEBUG) {
          console.log("🔒 Freezing APS contract:", contractId);
        }

        // APS expects YYYY-MM-DD
        const freezeFrom = new Date(freezeStartDate)
          .toISOString()
          .split("T")[0];

        const freezeTo = reactivateOn
          .toISOString()
          .split("T")[0];

        const apsFreezeResponse = await freezeContract(contractId, {
          from: freezeFrom,
          to: freezeTo,
          comment: reasonForFreezing || "Membership freeze",
        });
        if (!apsFreezeResponse?.status) {
          await t.rollback();
          return {
            status: false,
            message:
              apsFreezeResponse?.message ||
              "Failed to freeze contract in AccessPaySuite.",
          };
        }

        if (DEBUG) {
          console.log("✅ APS contract frozen successfully:", contractId);
        }
      }
      // 🔹 5B. Freeze in GoCardless (ONLY if bank)
      else if (bookingPayment.paymentType === "bank") {

        const subscriptionId = bookingPayment.goCardlessSubscriptionId;

        if (!subscriptionId) {
          await t.rollback();
          return {
            status: false,
            message: "GoCardless subscription ID missing."
          };
        }

        const gcPauseResponse = await pauseGoCardlessSubscription({
          subscriptionId,
          freezeDurationMonths,
          reasonForFreezing
        });

        if (!gcPauseResponse?.status) {
          await t.rollback();
          return {
            status: false,
            message: gcPauseResponse.message
          };
        }
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
    await booking.update({ status: "frozen" }, { transaction: t });

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
        bookingId
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

    // Select only recurring or full_payment category
    const bookingPayment = booking.payments.find(p =>
      p.paymentCategory === "recurring" || p.paymentCategory === "full_payment"
    );

    if (!bookingPayment) {
      await t.rollback();
      return { status: false, message: "Booking payment not found for recurring/full_payment." };
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
    // 7. BANK / GOCARDLESS REACTIVATION
    // ==================================================
    else if (paymentType === "bank") {

      const subscriptionId = bookingPayment.goCardlessSubscriptionId;

      if (!subscriptionId) {
        await t.rollback();
        return {
          status: false,
          message: "GoCardless subscription ID missing."
        };
      }

      const gcResume = await resumeGoCardlessSubscription({
        subscriptionId
      });

      if (!gcResume.status) {
        await t.rollback();
        return {
          status: false,
          message: gcResume.message
        };
      }

      await bookingPayment.update(
        {
          paymentStatus: "active"
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

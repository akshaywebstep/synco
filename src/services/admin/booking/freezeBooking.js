// const { sequelize, Booking, FreezeBooking } = require("../../../models");
const {
  sequelize,
  FreezeBooking,
  Booking,
  BookingStudentMeta,
  BookingParentMeta,
  BookingEmergencyMeta,
  Venue,
  ClassSchedule,
  PaymentPlan,
  WaitingList,
  CancelBooking,
} = require("../../../models");
const { Op } = require("sequelize");

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

    // 🔹 2. Calculate reactivation date
    const reactivateOn = new Date(freezeStartDate);
    reactivateOn.setMonth(reactivateOn.getMonth() + freezeDurationMonths);

    // 🔹 3. Prevent duplicate active freeze
    const existingFreeze = await FreezeBooking.findOne({
      where: {
        bookingId,
        reactivateOn: { [Op.gte]: new Date() }, // still active
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

    // 🔹 4. Create FreezeBooking record
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

    // 🔹 5. Update booking status
    // await booking.update({ status: "frozen" }, { transaction: t });

    await t.commit();
    return {
      status: true,
      message: "Booking frozen successfully.",
      data: { freezeRecord, bookingDetails: booking },
    };
  } catch (error) {
    await t.rollback();
    console.error("❌ createFreezeBooking Error:", error);
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

exports.reactivateBooking = async (
  bookingId,
  reactivateOn = null,
  additionalNote = null
) => {
  const t = await sequelize.transaction();
  try {
    // 🔹 1. Try to find active freeze record
    let freezeRecord = await FreezeBooking.findOne({
      where: {
        bookingId,
        reactivateOn: { [Op.gte]: new Date() },
      },
      transaction: t,
    });

    // 🔹 2. Fetch booking
    const booking = await Booking.findByPk(bookingId, { transaction: t });
    if (!booking) {
      await t.rollback();
      return { status: false, message: "Booking not found." };
    }

    // 🔹 3. Check if booking can be reactivated
    if (!freezeRecord && booking.status !== "frozen") {
      await t.rollback();
      return {
        status: false,
        message: "No active freeze found for this booking.",
      };
    }

    // 🔹 4. Prepare update data
    const updatedData = {
      status: "active",
      additionalNote: additionalNote, // always update
    };

    // Update reactivate date if provided
    if (reactivateOn) updatedData.reactivateOn = reactivateOn;

    await booking.update(updatedData, { transaction: t });

    // 🔹 5. Delete freeze record if it exists
    if (freezeRecord) {
      await freezeRecord.destroy({ transaction: t });
    }

    // 🔹 6. Fetch full updated booking with nested data
    const updatedBooking = await Booking.findByPk(bookingId, {
      include: [
        {
          model: ClassSchedule,
          as: "classSchedule",
          required: true,
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
      transaction: t,
    });

    await t.commit();

    return {
      status: true,
      message: "Booking reactivated successfully.",
      data: updatedBooking,
    };
  } catch (error) {
    await t.rollback();
    console.error("❌ reactivateBooking Service Error:", error);
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

const {
  sequelize,
  Credits,
  Booking,
  ClassSchedule,
  Venue,
} = require("../../../models");

exports.createCredit = async ({
  bookingId = null,
  creditAmount = 0,
  reason = "auto", // must be "auto" or "manual"
}) => {
  const t = await sequelize.transaction();
  try {
    let booking = null;
    let scheduleDetails = null;

    // 🔹 1. Booking validation (optional)
    if (bookingId) {
      booking = await Booking.findByPk(bookingId, {
        include: [
          {
            model: ClassSchedule,
            as: "classSchedule",
            include: [{ model: Venue, as: "venue" }],
          },
        ],
        transaction: t,
      });

      if (!booking) {
        await t.rollback();
        return { status: false, message: "❌ Booking not found." };
      }

      scheduleDetails = {
        classDate: booking.classSchedule?.date || null,
        classTime: booking.classSchedule?.time || null,
        venueName: booking.classSchedule?.venue?.name || null,
      };

      // 🔹 2. Update ClassSchedule status → cancelled (via FK in Booking table)
      if (booking.classScheduleId) {
        await ClassSchedule.update(
          { status: "cancelled" },
          { where: { id: booking.classScheduleId }, transaction: t }
        );
      }
    }

    // 🔹 3. Create credit record
    const creditRecord = await Credits.create(
      {
        bookingId,
        classScheduleId: booking?.classScheduleId || null, // ✅ save relation
        creditAmount,
        reason,
      },
      { transaction: t }
    );

    await t.commit();
    return {
      status: true,
      message: "✅ Credit created successfully & Class Schedule cancelled.",
      data: {
        credit: creditRecord,
        booking,
        scheduleDetails,
      },
    };
  } catch (error) {
    await t.rollback();
    console.error("❌ createCredit Error:", error);
    return { status: false, message: error.message };
  }
};

// ✅ Get All Credits (listing)
exports.getAllCredits = async () => {
  try {
    const credits = await Credits.findAll({
      include: [
        {
          model: Booking,
          as: "booking",
          include: [
            {
              model: ClassSchedule,
              as: "classSchedule",
            },
          ],
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    return {
      status: true,
      message: "✅ Credits fetched successfully.",
      data: credits,
    };
  } catch (error) {
    console.error("❌ getAllCredits Error:", error);
    return { status: false, message: error.message };
  }
};

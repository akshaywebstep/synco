const {
  HolidayBooking,
  HolidayBookingStudentMeta,
  HolidayVenue,
  HolidayClassSchedule,
  sequelize
} = require("../../../../models");

exports.getAttendanceRegister = async (classScheduleId) => {
  try {
    // 1️⃣ Fetch bookings for the given class schedule
    const holidayBookings = await HolidayBooking.findAll({
      include: [
        {
          model: HolidayBookingStudentMeta,
          as: "students",
          where: { classScheduleId },   // ✅ CORRECT PLACE
          required: true,               // 🔥 IMPORTANT
          attributes: [
            "id",
            "studentFirstName",
            "studentLastName",
            "age",
            "gender",
            "attendance",
            "classScheduleId",
          ],
        },
        {
          model: HolidayVenue,
          as: "holidayVenue",
          attributes: ["id", "name", "address", "area", "facility"],
          required: false,
        },
      ],
      order: [["createdAt", "ASC"]],
    });

    if (!holidayBookings || holidayBookings.length === 0) {
      return {
        status: false,
        message: "No bookings found for this class schedule.",
      };
    }

    // 2️⃣ Fetch class schedule details
    const holidayClassSchedule = await HolidayClassSchedule.findByPk(
      classScheduleId,
      {
        attributes: ["id", "className", "startTime", "endTime", "createdAt"],
      }
    );

    if (!holidayClassSchedule) {
      return {
        status: false,
        message: "Class schedule not found.",
      };
    }

    const members = [];
    const trials = [];

    // 3️⃣ Prepare booking data
    for (const booking of holidayBookings) {
      const bookingData = {
        id: booking.id,
        bookingType: booking.bookingType,
        status: booking.status,
        students: booking.students || [],
        createdAt: booking.createdAt,
        holidayVenue: booking.holidayVenue || null,
      };

      if (booking.bookingType === "waiting list" || booking.bookingType === "removed") {
        trials.push(bookingData);
      } else if (booking.bookingType === "paid") {
        members.push(bookingData);
      }
    }

    // Top-level venue (from first booking)
    const topLevelVenue = holidayBookings[0]?.holidayVenue || null;

    return {
      status: true,
      message: "Attendance register fetched successfully.",
      data: {
        holidayClassSchedule,
        holidayVenue: topLevelVenue,
        members,
        // trials,
      },
    };
  } catch (error) {
    console.error("❌ AttendanceRegisterService Error:", error);
    return { status: false, message: error.message };
  }
};

// exports.updateAttendanceStatus = async (studentId, attendance) => {
//   try {
//     // ✅ Validate input
//     if (!studentId || !["attended", "not attended"].includes(attendance)) {
//       return { status: false, message: "Invalid studentId or attendance value." };
//     }

//     // ✅ Update attendance
//     const [updatedRows] = await HolidayBookingStudentMeta.update(
//       { attendance },
//       { where: { id: studentId } }
//     );

//     if (updatedRows === 0) {
//       return { status: false, message: "Student not found or no change made." };
//     }

//     return {
//       status: true,
//       message: "Student attendance updated successfully.",
//       data: { id: studentId, attendance },
//     };
//   } catch (error) {
//     console.error("❌ updateAttendanceStatus Service Error:", error);
//     return { status: false, message: error.message };
//   }
// };

exports.updateAttendanceStatus = async (studentId, attendance) => {
  const t = await sequelize.transaction();
  try {
    // ✅ Validate input
    if (!studentId || !["attended", "not attended", "pending"].includes(attendance)) {
      return { status: false, message: "Invalid studentId or attendance value." };
    }

    // ✅ Update the student record
    const [updatedRows] = await HolidayBookingStudentMeta.update(
      { attendance },
      { where: { id: studentId }, transaction: t }
    );

    if (updatedRows === 0) {
      await t.rollback();
      return { status: false, message: "Student not found or no change made." };
    }

    // ✅ Fetch the bookingId of this student
    const student = await HolidayBookingStudentMeta.findByPk(studentId, { transaction: t });
    if (!student) {
      await t.rollback();
      return { status: false, message: "Student not found." };
    }

    const bookingId = student.bookingId;

    // ✅ Fetch all students under the same booking
    const allStudents = await HolidayBookingStudentMeta.findAll({
      where: { bookingId },
      transaction: t,
    });

    // ✅ Determine if booking can be marked attended
    const allAttended = allStudents.every(s => s.attendance === "attended");

    // ✅ Update booking status only if all students attended
    if (allAttended) {
      await HolidayBooking.update(
        { status: "Attended", updatedAt: new Date() },
        { where: { id: bookingId }, transaction: t }
      );
    }

    await t.commit();

    return {
      status: true,
      message: "Student attendance updated successfully.",
      data: { studentId, attendance, bookingUpdated: allAttended },
    };
  } catch (error) {
    await t.rollback();
    console.error("❌ updateAttendanceStatus Service Error:", error);
    return { status: false, message: error.message };
  }
};
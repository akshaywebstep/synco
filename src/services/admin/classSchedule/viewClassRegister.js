

const { Booking, BookingStudentMeta, Venue, ClassSchedule } = require("../../../models");
const { sequelize } = require("../../../models");

exports.getAttendanceRegister = async (classScheduleId) => {
  try {
    // 1️⃣ Fetch bookings via students.classScheduleId
    const bookings = await Booking.findAll({
      include: [
        {
          model: BookingStudentMeta,
          as: "students",
          where: { classScheduleId }, // ✅ CORRECT
          required: true,             // 🔥 INNER JOIN
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
          model: Venue,
          as: "venue",
          attributes: ["id", "name", "address", "area", "facility"],
          required: false,
        },
      ],
      order: [["createdAt", "ASC"]],
    });

    if (!bookings || bookings.length === 0) {
      return {
        status: false,
        message: "No bookings found for this class schedule.",
      };
    }

    // 2️⃣ Fetch class schedule
    const classSchedule = await ClassSchedule.findByPk(classScheduleId, {
      attributes: ["id", "className", "startTime", "endTime", "createdAt"],
    });

    if (!classSchedule) {
      return {
        status: false,
        message: "Class schedule not found.",
      };
    }

    const members = [];
    const trials = [];

    // 3️⃣ Prepare response
    for (const booking of bookings) {
      const bookingData = {
        id: booking.id,
        bookingType: booking.bookingType,
        status: booking.status,
        students: booking.students || [],
        createdAt: booking.createdAt,
        venue: booking.venue || null,
      };

      if (booking.bookingType === "free") {
        trials.push(bookingData);
      } else if (booking.bookingType === "paid") {
        members.push(bookingData);
      }
    }

    // Top-level venue (safe)
    const topLevelVenue = bookings[0]?.venue || null;

    return {
      status: true,
      message: "Attendance register fetched successfully.",
      data: {
        classSchedule,
        venue: topLevelVenue,
        members,
        trials,
      },
    };
  } catch (error) {
    console.error("❌ AttendanceRegisterService Error:", error);
    return { status: false, message: error.message };
  }
};

exports.updateAttendanceStatus = async (studentId, attendance) => {
  const t = await sequelize.transaction();
  try {
    // ✅ Validate input
    if (!studentId || !["attended", "not attended"].includes(attendance)) {
      return { status: false, message: "Invalid studentId or attendance value." };
    }

    // ✅ Update the student record
    const [updatedRows] = await BookingStudentMeta.update(
      { attendance },
      { where: { id: studentId }, transaction: t }
    );

    if (updatedRows === 0) {
      await t.rollback();
      return { status: false, message: "Student not found or no change made." };
    }

    // ✅ Fetch the bookingTrialId of this student
    const student = await BookingStudentMeta.findByPk(studentId, { transaction: t });
    if (!student) {
      await t.rollback();
      return { status: false, message: "Student not found." };
    }

    const bookingId = student.bookingTrialId;

    // ✅ Fetch all students under the same booking
    const allStudents = await BookingStudentMeta.findAll({
      where: { bookingTrialId: bookingId },
      transaction: t,
    });

    // ✅ Determine if booking can be marked attended
    const allAttended = allStudents.every(s => s.attendance === "attended");

    // ✅ Update booking status only if all students attended
    if (allAttended) {
      await Booking.update(
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

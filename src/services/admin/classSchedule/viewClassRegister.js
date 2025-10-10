

const { Booking, BookingStudentMeta, Venue, ClassSchedule } = require("../../../models");

exports.getAttendanceRegister = async (classScheduleId) => {
  try {
    // 1️⃣ Fetch bookings first
    const bookings = await Booking.findAll({
      where: { classScheduleId },
      include: [
        {
          model: BookingStudentMeta,
          as: "students",
          attributes: [
            "id",
            "studentFirstName",
            "studentLastName",
            "age",
            "gender",
            "attendance",
          ],
        },
        {
          model: Venue,
          as: "venue",
          attributes: ["id", "name", "address", "area", "facility"],
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

    // 2️⃣ Only fetch class schedule if there are bookings
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

    for (const booking of bookings) {
      const bookingData = {
        id: booking.id,
        bookingType: booking.bookingType,
        classScheduleId: booking.classScheduleId,
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

    // Top-level venue (from first booking, optional)
    const topLevelVenue = bookings[0]?.venue || null;

    return {
      status: true,
      message: "Attendance register fetched successfully.",
      data: {
        classSchedule, // 🔹 full class schedule details
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
  try {
    // ✅ Validate input
    if (!studentId || !["attended", "not attended"].includes(attendance)) {
      return { status: false, message: "Invalid studentId or attendance value." };
    }

    // ✅ Update the student record
    const [updatedRows] = await BookingStudentMeta.update(
      { attendance },
      { where: { id: studentId } }
    );

    if (updatedRows === 0) {
      return { status: false, message: "Student not found or no change made." };
    }

    return {
      status: true,
      message: "Student attendance updated successfully.",
      data: { id: studentId, attendance },
    };
  } catch (error) {
    console.error("❌ updateAttendanceStatus Service Error:", error);
    return { status: false, message: error.message };
  }
};
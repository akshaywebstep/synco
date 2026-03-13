const {
  sequelize,
  Booking,
  BookingStudentMeta,
  ClassSchedule,
  Venue,
  Admin,
} = require("../../../models");
const { Op } = require("sequelize");

exports.getAllBookings = async (adminId, filters = {}) => {
  try {
    const trialWhere = {
      bookingType: { [Op.in]: ["free", "paid"] },
      // bookedBy: adminId, // ✅ only bookings created by this admin
    };

    if (filters.venueId) trialWhere.venueId = filters.venueId;
    if (filters.bookedBy) trialWhere.bookedBy = filters.bookedBy;

    // --- Build venueWhere for date filtering ---
    const venueWhere = {};
    if (filters.fromDate && filters.toDate) {
      venueWhere.createdAt = {
        [Op.between]: [
          new Date(filters.fromDate + " 00:00:00"),
          new Date(filters.toDate + " 23:59:59"),
        ],
      };
    } else if (filters.fromDate) {
      venueWhere.createdAt = { [Op.gte]: new Date(filters.fromDate + " 00:00:00") };
    } else if (filters.toDate) {
      venueWhere.createdAt = { [Op.lte]: new Date(filters.toDate + " 23:59:59") };
    }

    // --- Determine which admins’ venues this admin can see ---
    const currentAdmin = await Admin.findByPk(adminId);
    if (!currentAdmin) {
      return { status: false, message: "Admin not found", data: [] };
    }

    let createdByIds = [];

    // SuperAdmin sees own + franchisee venues
    if (!currentAdmin.superAdminId) {
      const childAdmins = await Admin.findAll({
        where: { superAdminId: adminId },
        attributes: ["id"],
      });
      createdByIds = [adminId, ...childAdmins.map(a => a.id)];
    } else {
      // Franchise sees only own venues
      createdByIds = [adminId];
    }

    // --- FETCH VENUES created by allowed admins ---
    const allVenues = await Venue.findAll({
      where: {
        ...venueWhere,
        createdBy: createdByIds, // ✅ updated
      },
      order: [["id", "ASC"]],
    });

    // --- FETCH CLASS SCHEDULES for these venues ---
    const allClassSchedules = await ClassSchedule.findAll({
      where: {
        venueId: allVenues.map((v) => v.id),
      },
      include: [{ model: Venue, as: "venue" }],
      order: [["id", "ASC"]],
    });

    // --- FETCH BOOKINGS ---
    const bookings = await Booking.findAll({
      order: [["id", "ASC"]],
      where: trialWhere,
      include: [
        {
          model: BookingStudentMeta,
          as: "students",
          where: filters.classScheduleId
            ? { classScheduleId: filters.classScheduleId } // ✅ filter by classScheduleId
            : undefined,
          required: false, // so bookings without students still appear
        },
        {
          model: ClassSchedule,
          as: "classSchedule",
          include: [{ model: Venue, as: "venue" }],
          required: false,
        },
      ],
    });
    // ✅ Debug: Console log all bookings
    console.log("Total bookings fetched:", bookings.length);
    bookings.forEach((booking, index) => {
      console.log(`Booking ${index + 1} - ID:`, booking.id);
      console.log("Booking Type:", booking.bookingType);
      console.log("Status:", booking.status);
      console.log("ClassSchedule included:", booking.classSchedule ? booking.classSchedule.id : "None");
      console.log("Students:");
      booking.students.forEach((s) => {
        console.log(`  Student ID: ${s.id}, Name: ${s.studentFirstName} ${s.studentLastName}, classScheduleId: ${s.classScheduleId}`);
      });
    });

    // --- BUILD VENUE MAP ---
    const venueMap = {};
    allVenues.forEach((venue) => {
      venueMap[venue.id] = {
        id: venue.id,
        name: venue.name,
        address: venue.address,
        createdAt: venue.createdAt,
        classes: [],
      };
    });

    // --- MAP CLASSES ---
    allClassSchedules.forEach((cls) => {
      const venue = cls.venue;
      if (!venue) return;

      if (!venueMap[venue.id]) {
        venueMap[venue.id] = {
          id: venue.id,
          name: venue.name,
          address: venue.address,
          createdAt: venue.createdAt,
          classes: [],
        };
      }

      if (!venueMap[venue.id].classes.some((c) => c.id === cls.id)) {
        venueMap[venue.id].classes.push({
          id: cls.id,
          className: cls.className,
          day: cls.day,
          startTime: cls.startTime,
          endTime: cls.endTime,
          capacity: cls.capacity,
          totalCapacity: cls.totalCapacity, // ✅ include totalCapacity
          bookings: [],
        });
      }
    });

    // --- MAP BOOKINGS INTO CLASSES ---
    bookings.forEach((booking) => {
      booking.students?.forEach((student) => {
        const classScheduleId = student.classScheduleId;
        if (!classScheduleId) return;

        // --- Find classSchedule and venue ---
        const cls = allClassSchedules.find((c) => c.id === classScheduleId);
        if (!cls) return;

        const venueId = cls.venueId;
        const venueEntry = venueMap[venueId];
        if (!venueEntry) return;

        // --- Check if class already exists in venue.classes ---
        let classEntry = venueEntry.classes.find((c) => c.id === classScheduleId);
        if (!classEntry) {
          classEntry = {
            id: cls.id,
            className: cls.className,
            day: cls.day,
            startTime: cls.startTime,
            endTime: cls.endTime,
            capacity: cls.capacity,
            totalCapacity: cls.totalCapacity,
            bookings: [],
          };
          venueEntry.classes.push(classEntry);
        }

        // --- Check if booking entry exists ---
        let bookingEntry = classEntry.bookings.find((b) => b.id === booking.id);
        if (!bookingEntry) {
          bookingEntry = {
            id: booking.id,
            bookingType: booking.bookingType,
            status: booking.status,
            trialDate: booking.trialDate,
            students: [],
          };
          classEntry.bookings.push(bookingEntry);
        }

        // --- Push student info only if not already added ---
        if (!bookingEntry.students.some((s) => s.id === student.id)) {
          bookingEntry.students.push({
            id: student.id,
            studentFirstName: student.studentFirstName,
            studentLastName: student.studentLastName,
            age: student.age,
          });
        }
      });
    });

    // --- CALCULATE STATS ---
    venues = Object.values(venueMap).map((venue) => {
      let totalCapacity = 0;
      let totalBooked = 0;
      let memberCount = 0;
      let freeTrialCount = 0;

      venue.classes = venue.classes.map((cls) => {
        const activeBookings = cls.bookings.filter(
          (booking) => ["active", "pending", "attended", "froze", "request_to_cancel", "waiting list"].includes(booking.status)
        );

        const clsTotalBooked = activeBookings.reduce(
          (sum, booking) => sum + (booking.students?.length || 0),
          0
        );

        let clsMembers = 0;
        let clsFreeTrials = 0;

        activeBookings.forEach((booking) => {
          if (booking.bookingType === "paid") clsMembers += booking.students.length;
          if (booking.bookingType === "free") clsFreeTrials += booking.students.length;
        });

        const clsStats = {
          totalCapacity: cls.totalCapacity || cls.capacity || 0,
          totalBooked: clsTotalBooked,
          availableSpaces: Math.max(0, (cls.totalCapacity || cls.capacity || 0) - clsTotalBooked),
          members: clsMembers,
          freeTrials: clsFreeTrials,
          occupancyRate: (cls.totalCapacity || cls.capacity)
            ? Math.round((clsTotalBooked / (cls.totalCapacity || cls.capacity)) * 100)
            : 0,
        };

        return { ...cls, stats: clsStats };
      });

      return venue;
    });

    // ✅ Remove venues with no classes
    venues = venues.filter((venue) => venue.classes.length > 0);

    // ✅ Build searchVenue list
    const searchVenue = venues.map((v) => ({
      id: v.id,
      venueName: v.name,
    }));

    // --- Optional filters ---
    if (filters.venueName) {
      const venueNames = Array.isArray(filters.venueName)
        ? filters.venueName.map((v) => v.toLowerCase().trim())
        : filters.venueName
          .split(",")
          .map((v) => v.toLowerCase().trim());
      venues = venues.filter((v) =>
        venueNames.some((kw) => v.name.toLowerCase().includes(kw))
      );
    }

    if (filters.studentName) {
      const keyword = filters.studentName.toLowerCase();
      venues = venues
        .map((venue) => {
          const filteredClasses = venue.classes.map((cls) => {
            const filteredBookings = cls.bookings.filter((booking) =>
              booking.students.some((s) =>
                `${s.studentFirstName} ${s.studentLastName}`
                  .toLowerCase()
                  .includes(keyword)
              )
            );
            return { ...cls, bookings: filteredBookings };
          });
          return { ...venue, classes: filteredClasses };
        })
        .filter((venue) =>
          venue.classes.some((cls) => cls.bookings.length > 0)
        );
    }

    // --- Global stats ---
    const globalStats = venues.reduce(
      (acc, venue) => {
        venue.classes.forEach((cls) => {
          acc.totalCapacity += cls.stats.totalCapacity;
          acc.totalBooked += cls.stats.totalBooked;
          acc.members += cls.stats.members;
          acc.freeTrials += cls.stats.freeTrials;
        });
        return acc;
      },
      { totalCapacity: 0, totalBooked: 0, members: 0, freeTrials: 0 }
    );

    // globalStats.availableSpaces = globalStats.totalCapacity;
    globalStats.availableSpaces = venues.reduce(
      (sum, venue) =>
        sum +
        venue.classes.reduce(
          (clsSum, cls) => clsSum + (cls.stats?.availableSpaces || 0),
          0
        ),
      0
    );

    globalStats.occupancyRate = globalStats.totalCapacity
      ? Math.round((globalStats.totalBooked / globalStats.totalCapacity) * 100)
      : 0;

    return {
      status: true,
      message: "Fetched venues with stats",
      data: { venues, overview: globalStats, searchVenue },
    };
  } catch (error) {
    console.error("❌ getAllBookings Error:", error.message);
    return { status: false, message: error.message };
  }
};

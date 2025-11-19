const {
  sequelize,
  Booking,
  BookingStudentMeta,
  ClassSchedule,
  Venue,
} = require("../../../models");
const { Op } = require("sequelize");

// exports.getAllBookings = async (adminId, filters = {}) => {
//   try {
//     // const trialWhere = {};
//     // trialWhere.bookingType = { [Op.in]: ["free", "paid"] };
//     const trialWhere = {
//       bookingType: { [Op.in]: ["free", "paid"] },
//       bookedBy: adminId, // ✅ only bookings created by the logged-in admin
//     };

//     if (filters.venueId) trialWhere.venueId = filters.venueId;
//     if (filters.bookedBy) trialWhere.bookedBy = filters.bookedBy;

//     // --- Build venueWhere for date filtering ---
//     const venueWhere = {};
//     if (filters.fromDate && filters.toDate) {
//       venueWhere.createdAt = {
//         [Op.between]: [
//           new Date(filters.fromDate + " 00:00:00"),
//           new Date(filters.toDate + " 23:59:59"),
//         ],
//       };
//     } else if (filters.fromDate) {
//       venueWhere.createdAt = {
//         [Op.gte]: new Date(filters.fromDate + " 00:00:00"),
//       };
//     } else if (filters.toDate) {
//       venueWhere.createdAt = {
//         [Op.lte]: new Date(filters.toDate + " 23:59:59"),
//       };
//     }

//     // --- FETCH ALL VENUES ---
//     // const allVenues = await Venue.findAll({
//     //   where: venueWhere,
//     //   order: [["id", "ASC"]],
//     // });

//     // --- FETCH ONLY VENUES OWNED BY THIS ADMIN ---
//     const allVenues = await Venue.findAll({
//       where: {
//         ...venueWhere,
//         createdBy: adminId, // ✅ only venues created/owned by the logged-in admin
//       },
//       order: [["id", "ASC"]],
//     });

//     // --- FETCH ALL CLASS SCHEDULES for these venues ---
//     const allClassSchedules = await ClassSchedule.findAll({
//       where: {
//         venueId: allVenues.map((v) => v.id), // ✅ force match venue IDs
//       },
//       include: [{ model: Venue, as: "venue" }],
//       order: [["id", "ASC"]],
//     });

//     // --- FETCH BOOKINGS (only for filtered venues) ---
//     const bookings = await Booking.findAll({
//       order: [["id", "ASC"]],
//       where: trialWhere,
//       include: [
//         { model: BookingStudentMeta, as: "students" },
//         {
//           model: ClassSchedule,
//           as: "classSchedule",
//           where: { venueId: allVenues.map((v) => v.id) }, // ✅ ensure only these venues
//           include: [{ model: Venue, as: "venue" }],
//         },
//       ],
//     });

//     // --- MAP VENUES INITIALLY ---
//     const venueMap = {};
//     allVenues.forEach((venue) => {
//       venueMap[venue.id] = {
//         id: venue.id,
//         name: venue.name,
//         address: venue.address,
//         createdAt: venue.createdAt,
//         classes: [],
//       };
//     });

//     // --- ADD CLASSES (empty bookings initially) ---
//     allClassSchedules.forEach((cls) => {
//       const venue = cls.venue;
//       if (!venue) return;

//       if (!venueMap[venue.id]) {
//         venueMap[venue.id] = {
//           id: venue.id,
//           name: venue.name,
//           address: venue.address,
//           createdAt: venue.createdAt,
//           classes: [],
//         };
//       }

//       if (!venueMap[venue.id].classes.some((c) => c.id === cls.id)) {
//         venueMap[venue.id].classes.push({
//           id: cls.id,
//           day: cls.day,
//           startTime: cls.startTime,
//           endTime: cls.endTime,
//           capacity: cls.capacity,
//           bookings: [], // initially empty
//         });
//       }
//     });

//     // --- MAP BOOKINGS INTO CLASSES ---
//     bookings.forEach((booking) => {
//       const venue = booking.classSchedule?.venue;
//       const classSchedule = booking.classSchedule;
//       if (!venue) return;

//       const venueEntry = venueMap[venue.id];
//       if (!venueEntry) return;

//       let classEntry = venueEntry.classes.find(
//         (cls) => cls.id === classSchedule.id
//       );
//       if (!classEntry) {
//         classEntry = {
//           id: classSchedule.id,
//           day: classSchedule.day,
//           startTime: classSchedule.startTime,
//           endTime: classSchedule.endTime,
//           capacity: classSchedule.capacity,
//           bookings: [],
//         };
//         venueEntry.classes.push(classEntry);
//       }

//       classEntry.bookings.push({
//         id: booking.id,
//         bookingType: booking.bookingType,
//         status: booking.status,
//         trialDate: booking.trialDate,
//         students:
//           booking.students?.map((s) => ({
//             id: s.id,
//             studentFirstName: s.studentFirstName,
//             studentLastName: s.studentLastName,
//             age: s.age,
//           })) || [],
//       });
//     });

//     // --- CALCULATE STATS ---
//     venues = Object.values(venueMap).map((venue) => {
//       let totalCapacity = 0;
//       let totalBooked = 0;
//       let memberCount = 0;
//       let freeTrialCount = 0;

//       // --- Add stats for each class ---
//       venue.classes = venue.classes.map((cls) => {
//         // let clsTotalBooked = cls.bookings.length;
//         let clsTotalBooked = cls.bookings.reduce(
//           (sum, booking) => sum + (booking.students?.length || 0),
//           0
//         );

//         let clsMembers = 0;
//         let clsFreeTrials = 0;

//         cls.bookings.forEach((booking) => {
//           if (booking.bookingType === "paid") clsMembers += booking.students.length;
//           if (booking.bookingType === "free") clsFreeTrials += booking.students.length;
//         });

//         // const clsStats = {
//         //   totalCapacity: cls.capacity || 0,
//         //   totalBooked: clsTotalBooked,
//         //   availableSpaces: (cls.capacity || 0) - clsTotalBooked,
//         //   members: clsMembers,
//         //   freeTrials: clsFreeTrials,
//         //   occupancyRate: cls.capacity
//         //     ? Math.round((clsTotalBooked / cls.capacity) * 100)
//         //     : 0,
//         // };
//         const clsStats = {
//           totalCapacity: cls.totalCapacity || 0,
//           totalBooked: clsTotalBooked,
//           availableSpaces: Math.max((cls.capacity || 0) - clsTotalBooked, 0),
//           members: clsMembers,
//           freeTrials: clsFreeTrials,
//           occupancyRate: cls.capacity
//             ? Math.round((clsTotalBooked / cls.capacity) * 100)
//             : 0,
//         };

//         totalCapacity += clsStats.totalCapacity;
//         totalBooked += clsStats.totalBooked;
//         memberCount += clsStats.members;
//         freeTrialCount += clsStats.freeTrials;

//         return { ...cls, stats: clsStats };
//       });

//       return venue;

//       // return {
//       //   ...venue,
//       //   stats: {
//       //     totalCapacity,
//       //     totalBooked,
//       //     availableSpaces: totalCapacity - totalBooked,
//       //     members: memberCount,
//       //     freeTrials: freeTrialCount,
//       //     occupancyRate: totalCapacity > 0 ? Math.round((totalBooked / totalCapacity) * 100) : 0,
//       //   },
//       // };
//     });

//     // ✅ Remove venues with no classes
//     venues = venues.filter((venue) => venue.classes.length > 0);

//     // ✅ Build searchVenue (only venues with classes)
//     const searchVenue = venues.map((v) => ({
//       id: v.id,
//       venueName: v.name,
//     }));

//     // --- Apply filters on venues (NOT searchVenue) ---

//     // Venue name filter
//     let venueNames = [];
//     if (filters.venueName) {
//       if (Array.isArray(filters.venueName)) {
//         venueNames = filters.venueName.map((v) => v.toLowerCase().trim());
//       } else if (typeof filters.venueName === "string") {
//         venueNames = filters.venueName
//           .split(",")
//           .map((v) => v.toLowerCase().trim());
//       }
//     }
//     if (venueNames.length > 0) {
//       venues = venues.filter((v) =>
//         venueNames.some((kw) => v.name.toLowerCase().includes(kw))
//       );
//     }

//     // Student name filter
//     if (filters.studentName) {
//       const keyword = filters.studentName.toLowerCase();
//       venues = venues
//         .map((venue) => {
//           const filteredClasses = venue.classes.map((cls) => {
//             const filteredBookings = cls.bookings.filter((booking) =>
//               booking.students.some((s) =>
//                 `${s.studentFirstName} ${s.studentLastName}`
//                   .toLowerCase()
//                   .includes(keyword)
//               )
//             );
//             return { ...cls, bookings: filteredBookings };
//           });
//           return { ...venue, classes: filteredClasses };
//         })
//         .filter((venue) =>
//           venue.classes.some((cls) => cls.bookings.length > 0)
//         );
//     }

//     const globalStats = venues.reduce((acc, venue) => {
//       venue.classes.forEach((cls) => {
//         acc.totalCapacity += cls.stats.totalCapacity;
//         acc.totalBooked += cls.stats.totalBooked;
//         acc.members += cls.stats.members;
//         acc.freeTrials += cls.stats.freeTrials;
//       });
//       return acc;
//     }, { totalCapacity: 0, totalBooked: 0, members: 0, freeTrials: 0 });

//     globalStats.availableSpaces = globalStats.totalCapacity - globalStats.totalBooked;
//     globalStats.occupancyRate = globalStats.totalCapacity
//       ? Math.round((globalStats.totalBooked / globalStats.totalCapacity) * 100)
//       : 0;

//     return {
//       status: true,
//       message: "Fetched venues with stats",
//       data: { venues, overview: globalStats, searchVenue },
//     };
//   } catch (error) {
//     console.error("❌ getAllBookings Error:", error.message);
//     return { status: false, message: error.message };
//   }
// };

// exports.getAllBookings = async (adminId, filters = {}) => {
//   try {
//     const trialWhere = {};

//     // ✅ include both free + paid
//     trialWhere.bookingType = { [Op.in]: ["free", "paid"] };

//     // Apply filters
//     if (filters.venueId) trialWhere.venueId = filters.venueId;
//     if (filters.trialDate) trialWhere.trialDate = filters.trialDate;
//     if (filters.status) trialWhere.status = filters.status;
//     if (filters.bookedBy) trialWhere.bookedBy = filters.bookedBy;

//     // Date filters
//     if (filters.fromDate && filters.toDate) {
//       trialWhere.createdAt = {
//         [Op.between]: [
//           new Date(filters.fromDate + " 00:00:00"),
//           new Date(filters.toDate + " 23:59:59"),
//         ],
//       };
//     }

//     // --- FETCH BOOKINGS ---
//     const bookings = await Booking.findAll({
//       order: [["id", "DESC"]],
//       where: trialWhere,
//       include: [
//         { model: BookingStudentMeta, as: "students" },
//         { model: BookingParentMeta, as: "parents" },
//         // { model: BookingEmergencyMeta, as: "emergency", required: false },
//         {
//           model: ClassSchedule,
//           as: "classSchedule",
//           include: [
//             {
//               model: Venue,
//               as: "venue",
//               where: filters.venueName
//                 ? { name: { [Op.like]: `%${filters.venueName}%` } }
//                 : undefined,
//             },
//           ],
//         },
//       ],
//     });

//     // --- TRANSFORM DATA ---
//     const venueMap = {};

//     bookings.forEach((booking) => {
//       const venue = booking.classSchedule?.venue;
//       const classSchedule = booking.classSchedule;

//       if (!venue) return;

//       // Ensure venue exists
//       if (!venueMap[venue.id]) {
//         venueMap[venue.id] = {
//           id: venue.id,
//           name: venue.name,
//           address: venue.address,
//           classes: {},
//         };
//       }

//       // Ensure class schedule exists under venue
//       if (!venueMap[venue.id].classes[classSchedule.id]) {
//         venueMap[venue.id].classes[classSchedule.id] = {
//           id: classSchedule.id,
//           day: classSchedule.day,
//           startTime: classSchedule.startTime,
//           endTime: classSchedule.endTime,
//           bookings: [],
//         };
//       }

//       // Push booking with correct structure
//       venueMap[venue.id].classes[classSchedule.id].bookings.push({
//         id: booking.id,
//         bookingType: booking.bookingType, // free or paid
//         status: booking.status,
//         trialDate: booking.trialDate,
//         students:
//           booking.students?.map((s) => ({
//             id: s.id,
//             studentFirstName: s.studentFirstName,
//             studentLastName: s.studentLastName,
//             dateOfBirth: s.dateOfBirth,
//             age: s.age,
//             gender: s.gender,
//             medicalInformation: s.medicalInformation,
//           })) || [],
//         parents:
//           booking.parents?.map((p) => ({
//             id: p.id,
//             parentFirstName: p.parentFirstName,
//             parentLastName: p.parentLastName,
//             parentEmail: p.parentEmail,
//             parentPhoneNumber: p.parentPhoneNumber,
//             relationToChild: p.relationToChild,
//             howDidYouHear: p.howDidYouHear,
//           })) || [],
//         // emergency: booking.emergency
//         //   ? {
//         //       emergencyFirstName: booking.emergency.emergencyFirstName,
//         //       emergencyLastName: booking.emergency.emergencyLastName,
//         //       emergencyPhoneNumber: booking.emergency.emergencyPhoneNumber,
//         //       emergencyRelation: booking.emergency.emergencyRelation,
//         //     }
//         //   : null,
//       });
//     });

//     // Convert classes object → array
//     const venues = Object.values(venueMap).map((venue) => ({
//       ...venue,
//       classes: Object.values(venue.classes),
//     }));

//     return {
//       status: true,
//       message: "Fetched venues with classes and bookings successfully.",
//       data: {
//         venues,
//       },
//     };
//   } catch (error) {
//     console.error("❌ getAllBookings Error:", error.message);
//     return { status: false, message: error.message };
//   }
// };

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

    // --- FETCH VENUES created by this admin ---
    const allVenues = await Venue.findAll({
      where: {
        ...venueWhere,
        createdBy: adminId,
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
        { model: BookingStudentMeta, as: "students" },
        {
          model: ClassSchedule,
          as: "classSchedule",
          where: { venueId: allVenues.map((v) => v.id) },
          include: [{ model: Venue, as: "venue" }],
        },
      ],
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
      const venue = booking.classSchedule?.venue;
      const classSchedule = booking.classSchedule;
      if (!venue) return;

      const venueEntry = venueMap[venue.id];
      if (!venueEntry) return;

      let classEntry = venueEntry.classes.find(
        (cls) => cls.id === classSchedule.id
      );
      if (!classEntry) {
        classEntry = {
          id: classSchedule.id,
          day: classSchedule.day,
          startTime: classSchedule.startTime,
          endTime: classSchedule.endTime,
          capacity: classSchedule.capacity,
          totalCapacity: classSchedule.totalCapacity, // ✅ preserve
          bookings: [],
        };
        venueEntry.classes.push(classEntry);
      }

      classEntry.bookings.push({
        id: booking.id,
        bookingType: booking.bookingType,
        status: booking.status,
        trialDate: booking.trialDate,
        students:
          booking.students?.map((s) => ({
            id: s.id,
            studentFirstName: s.studentFirstName,
            studentLastName: s.studentLastName,
            age: s.age,
          })) || [],
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
          (booking) => booking.status !== "cancelled"
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
          availableSpaces: (cls.capacity || 0) - clsTotalBooked,
          members: clsMembers,
          freeTrials: clsFreeTrials,
          occupancyRate: cls.capacity
            ? Math.round((clsTotalBooked / cls.capacity) * 100)
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
          (clsSum, cls) => clsSum + (cls.capacity || 0),
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

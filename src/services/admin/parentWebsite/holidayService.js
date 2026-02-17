const {
    HolidayVenue,
    HolidayClassSchedule,
    HolidayPaymentPlan,
    HolidayCamp,
    HolidayCampDates,
    HolidayPaymentGroup,
    HolidayPaymentGroupHasPlan,
    HolidayBooking,
    HolidayBookingStudentMeta,
    HolidayBookingParentMeta,
    HolidayBookingEmergencyMeta,
    Admin,
    Role,
} = require("../../../models");

const { Op, Sequelize } = require("sequelize");
const { sequelize } = require("../../../models");
const DEBUG = process.env.DEBUG === "true";

function deg2rad(deg) {
    return deg * (Math.PI / 180);
}

function calculateDistance(lat1, lng1, lat2, lng2) {
    const earthRadiusMiles = 3959; // miles
    const dLat = deg2rad(lat2 - lat1);
    const dLng = deg2rad(lng2 - lng1);

    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * Math.sin(dLng / 2) ** 2;

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return earthRadiusMiles * c;
}

exports.getAllHolidayVenuesWithHolidayClasses = async ({
    userLatitude,
    userLongitude,
    searchRadiusMiles,
}) => {
    try {

        let venues;
        const hasCoordinates =
            typeof userLatitude === "number" && typeof userLongitude === "number";

        if (hasCoordinates) {
            console.log("✅ User coordinates provided:", { userLatitude, userLongitude, searchRadiusMiles });
        } else {
            console.log("⚠️ User coordinates missing. Distance will not be calculated.");
        }

        if (hasCoordinates) {
            const distanceFormula = Sequelize.literal(`
        3959 * acos(
          cos(radians(${userLatitude}))
          * cos(radians(\`latitude\`))
          * cos(radians(\`longitude\`) - radians(${userLongitude}))
          + sin(radians(${userLatitude}))
          * sin(radians(\`latitude\`))
        )
      `);

            const whereCondition =
                typeof searchRadiusMiles === "number" && searchRadiusMiles > 0
                    ? Sequelize.where(distanceFormula, { [Op.lte]: searchRadiusMiles })
                    : {};

            venues = await HolidayVenue.findAll({
                where: {
                    ...whereCondition,
                },

                attributes: {
                    include: [[distanceFormula, "distanceMiles"]],
                },
                include: [
                    {
                        model: HolidayClassSchedule,
                        as: "holidayClassSchedules",
                        required: true, // ✅ Only include venues that HAVE classes
                    },
                ],
                order: [[Sequelize.col("distanceMiles"), "DESC"]],
            });
        } else {
            venues = await HolidayVenue.findAll({
                where: {},

                // ✅ only super admin’s venues
                include: [
                    {
                        model: HolidayClassSchedule,
                        as: "holidayClassSchedules",
                        required: true, // ✅ Only include venues that HAVE classes
                    },
                ],
                order: [["id", "DESC"]],
            });
        }

        if (!venues || venues.length === 0) {
            return { status: true, data: [] };
        }

        const formattedVenues = await Promise.all(
            venues.map(async (venue) => {

                // ⛔ If venue has no classes, skip
                if (!venue.holidayClassSchedules || venue.holidayClassSchedules.length === 0) {
                    return null;
                }

                // ---------- Payment Groups ----------
                const paymentGroups =
                    venue.paymentGroupId != null
                        ? await HolidayPaymentGroup.findAll({
                            where: {
                                id: venue.paymentGroupId,
                            },
                            include: [
                                {
                                    model: HolidayPaymentPlan,
                                    as: "holidayPaymentPlans",
                                    through: {
                                        model: HolidayPaymentGroupHasPlan,
                                        attributes: [
                                            "id",
                                            "payment_plan_id",
                                            "payment_group_id",
                                            "createdBy",
                                            "createdAt",
                                            "updatedAt",
                                        ],
                                    },
                                },
                            ],
                            order: [["createdAt", "DESC"]],
                        })
                        : [];

                // ---------- Holiday Camps ----------
                let holidayCampIds = [];
                if (typeof venue.holidayCampId === "string") {
                    try {
                        holidayCampIds = JSON.parse(venue.holidayCampId);
                    } catch {
                        holidayCampIds = [];
                    }
                } else if (Array.isArray(venue.holidayCampId)) {
                    holidayCampIds = venue.holidayCampId;
                }

                const holidayCamps = holidayCampIds.length
                    ? await HolidayCamp.findAll({
                        where: {
                            id: holidayCampIds,
                        },
                    })
                    : [];

                // ---------- Holiday Camp Dates ----------
                const holidayCampDates = holidayCampIds.length
                    ? await HolidayCampDates.findAll({
                        where: {
                            holidayCampId: { [Op.in]: holidayCampIds },
                        },
                        attributes: [
                            "id",
                            "startDate",
                            "endDate",
                            "holidayCampId",
                            "totalDays",
                            "sessionsMap",
                        ],
                    })
                    : [];

                const parsedHolidayCampDate = holidayCampDates.map((t) => ({
                    id: t.id,
                    startDate: t.startDate,
                    endDate: t.endDate,
                    holidayCampId: t.holidayCampId,
                    totalDays: t.totalDays,
                    sessionsMap:
                        typeof t.sessionsMap === "string"
                            ? JSON.parse(t.sessionsMap)
                            : t.sessionsMap || [],
                }));

                // ---------- Class Grouping ----------
                // ---------- Class List (No Day Grouping) ----------
                const venueClasses = (venue.holidayClassSchedules || []).map((cls) => ({
                    classId: cls.id,
                    className: cls.className,
                    time: `${cls.startTime} - ${cls.endTime}`,
                    capacity: cls.capacity,
                    totalCapacity: cls.totalCapacity,
                }));

                // ---------- Distance Calculation ----------
                const venueLat = parseFloat(venue.latitude);
                const venueLng = parseFloat(venue.longitude);

                const distanceMiles =
                    !isNaN(venueLat) &&
                        !isNaN(venueLng) &&
                        typeof userLatitude === "number" &&
                        typeof userLongitude === "number"
                        ? parseFloat(
                            calculateDistance(
                                userLatitude,
                                userLongitude,
                                venueLat,
                                venueLng
                            ).toFixed(1)
                        )
                        : null;

                return {
                    venueId: venue.id,
                    venueName: venue.name,
                    area: venue.area,
                    address: venue.address,
                    facility: venue.facility,
                    congestionNote: venue.congestionNote,
                    parkingNote: venue.parkingNote,
                    latitude: venue.latitude,
                    longitude: venue.longitude,
                    createdAt: venue.createdAt,
                    postal_code: venue.postal_code,
                    distanceMiles,
                    classes: venueClasses,

                    paymentGroups: paymentGroups.map((pg) => ({
                        id: pg.id,
                        name: pg.name,
                        description: pg.description,
                        createdBy: pg.createdBy,
                        createdAt: pg.createdAt,
                        updatedAt: pg.updatedAt,
                        holidayPaymentPlans: (pg.holidayPaymentPlans || []).map((plan) => ({
                            id: plan.id,
                            title: plan.title,
                            price: plan.price,
                            interval: plan.interval,
                            duration: plan.duration,
                            students: plan.students,
                            joiningFee: plan.joiningFee,
                            HolidayCampPackage: plan.HolidayCampPackage,
                            termsAndCondition: plan.termsAndCondition,
                            createdBy: plan.createdBy,
                            createdAt: plan.createdAt,
                            updatedAt: plan.updatedAt,
                            PaymentGroupHasPlan: plan.PaymentGroupHasPlan || null,
                        })),
                    })),

                    holidayCamps: holidayCamps.map((group) => ({
                        id: group.id,
                        name: group.name,
                    })),

                    holidayCampDates: parsedHolidayCampDate,

                };
            })
        );

        const filteredVenues = formattedVenues.filter(Boolean);

        return { status: true, data: filteredVenues };
    } catch (error) {
        console.error("❌ getAllVenuesWithClasses Error:", error);
        return {
            status: false,
            message: error.message || "Failed to fetch class listings",
        };
    }
};

exports.getHolidayClassById = async (classId) => {
    try {

        // 🔍 Fetch the class + venue
        const cls = await HolidayClassSchedule.findOne({
            where: {
                id: classId,
            },
            include: [
                {
                    model: HolidayVenue,
                    as: "venue",
                    required: true,
                    where: {}
                }
            ]
        });

        if (!cls) {
            return { status: false, message: "Holiday class not found." };
        }

        const venue = cls.venue;

        // ================================
        // 🟦 PAYMENT GROUPS WITH PLANS
        // ================================
        let paymentGroups = [];
        if (venue.paymentGroupId) {
            paymentGroups = await HolidayPaymentGroup.findAll({
                where: {
                    id: venue.paymentGroupId,
                },
                include: [
                    {
                        model: HolidayPaymentPlan,
                        as: "holidayPaymentPlans",
                        through: {
                            model: HolidayPaymentGroupHasPlan,
                            attributes: [
                                "id",
                                "payment_plan_id",
                                "payment_group_id",
                                "createdBy",
                                "createdAt",
                                "updatedAt"
                            ]
                        }
                    }
                ],
                order: [["createdAt", "DESC"]]
            });
        }

        venue.dataValues.paymentGroups = paymentGroups;

        // ================================
        // 🟦 HOLIDAY CAMPS
        // ================================
        let holidayCampIds = [];

        if (typeof venue.holidayCampId === "string") {
            try {
                holidayCampIds = JSON.parse(venue.holidayCampId);
            } catch {
                holidayCampIds = [];
            }
        } else if (Array.isArray(venue.holidayCampId)) {
            holidayCampIds = venue.holidayCampId;
        }

        const holidayCamps = holidayCampIds.length
            ? await HolidayCamp.findAll({
                where: {
                    id: holidayCampIds,
                }
            })
            : [];

        venue.dataValues.holidayCamps = holidayCamps;

        // ================================
        // 🟦 HOLIDAY CAMP DATES
        // ================================
        const holidayCampDates = holidayCampIds.length
            ? await HolidayCampDates.findAll({
                where: {
                    holidayCampId: { [Op.in]: holidayCampIds },
                },
                attributes: [
                    "id",
                    "startDate",
                    "endDate",
                    "holidayCampId",
                    "totalDays",
                    "sessionsMap"
                ]
            })
            : [];

        venue.dataValues.holidayCampDates = holidayCampDates.map((d) => ({
            id: d.id,
            startDate: d.startDate,
            endDate: d.endDate,
            holidayCampId: d.holidayCampId,
            totalDays: d.totalDays,
            sessionsMap:
                typeof d.sessionsMap === "string"
                    ? JSON.parse(d.sessionsMap)
                    : d.sessionsMap || []
        }));

        // ================================
        // 🟦 RETURN FINAL RESPONSE
        // ================================
        return {
            status: true,
            message: "Holiday class details fetched successfully.",
            data: cls
        };

    } catch (error) {
        console.error("❌ getHolidayClassById Error:", error.message);
        return {
            status: false,
            message: "Fetch failed: " + error.message
        };
    }
};
exports.updateHolidayBookingsForParent = async (
  data,
  { parentAdminId }
) => {
  const transaction = await sequelize.transaction();

  try {
    DEBUG && console.log("🧪 STEP 0: INPUTS");
    DEBUG && console.log("parentAdminId:", parentAdminId, typeof parentAdminId);
    DEBUG && console.log("students:", data?.students?.length);
    DEBUG && console.log("parents:", data?.parents?.length);
    DEBUG && console.log("emergencyContacts:", data?.emergencyContacts?.length);

    if (!Number.isInteger(parentAdminId)) {
      throw new Error("Invalid parentAdminId");
    }

    // ========================
    // 🔎 STEP 1: FETCH ALL BOOKINGS for parentAdminId
    // ========================
    const bookings = await HolidayBooking.findAll({
      where: { parentAdminId },
      include: [
        {
          model: HolidayBookingStudentMeta,
          as: "students",
          include: [
            { model: HolidayBookingParentMeta, as: "parents" },
            { model: HolidayBookingEmergencyMeta, as: "emergencyContacts" }
          ]
        }
      ],
      transaction
    });

    DEBUG && console.log(`🧪 STEP 1: Found ${bookings.length} bookings for parentAdminId ${parentAdminId}`);

    if (!bookings.length) throw new Error("No bookings found for this parentAdminId");

    let totalAddedStudents = 0;

    // ========================
    // 🔎 STEP 2: Loop all bookings and update each one
    // ========================
    for (const booking of bookings) {
      DEBUG && console.log(`🧪 STEP 2: Processing bookingId: ${booking.id}`);

      // Fetch ClassSchedule for capacity check
      const classSchedule = await HolidayClassSchedule.findByPk(
        booking.classScheduleId,
        { transaction }
      );

      if (!classSchedule) throw new Error(`Class schedule not found for bookingId ${booking.id}`);

      // ========================
      // 1️⃣ STUDENTS
      // ========================
      if (Array.isArray(data.students)) {
        DEBUG && console.log("🧪 STEP 3: STUDENTS LOOP for bookingId", booking.id);

        for (const student of data.students) {
          DEBUG && console.log("➡️ Student payload:", student);

          if (Number.isInteger(student.id)) {
            DEBUG && console.log("🟢 Updating student ID:", student.id);

            await HolidayBookingStudentMeta.update(
              {
                studentFirstName: student.studentFirstName,
                studentLastName: student.studentLastName,
                dateOfBirth: student.dateOfBirth,
                age: student.age,
                gender: student.gender,
                medicalInformation: student.medicalInformation,
              },
              { where: { id: student.id }, transaction }
            );
          } else {
            DEBUG && console.log("🟢 Creating new student");

            if (classSchedule.capacity < 1) {
              throw new Error(
                `No capacity available. Remaining: ${classSchedule.capacity} for bookingId ${booking.id}`
              );
            }

            await HolidayBookingStudentMeta.create(
              {
                bookingId: booking.id,
                studentFirstName: student.studentFirstName,
                studentLastName: student.studentLastName,
                dateOfBirth: student.dateOfBirth,
                age: student.age,
                gender: student.gender,
                medicalInformation: student.medicalInformation,
              },
              { transaction }
            );

            totalAddedStudents++;
            classSchedule.capacity -= 1;
            await classSchedule.save({ transaction });
          }
        }
      }

      // ========================
      // 2️⃣ PARENTS
      // ========================
      if (Array.isArray(data.parents)) {
        DEBUG && console.log("🧪 STEP 4: PARENTS LOOP for bookingId", booking.id);

        let adminSynced = false;

        for (const p of data.parents) {
          DEBUG && console.log("➡️ Parent payload:", p);

          const relationToChild = p.relationToChild || p.relationChild;
          const howDidYouHear = p.howDidYouHear || p.howDidHear;

          if (Number.isInteger(p.id)) {
            DEBUG && console.log("🟢 Updating parent meta ID:", p.id);

            await HolidayBookingParentMeta.update(
              {
                parentFirstName: p.parentFirstName,
                parentLastName: p.parentLastName,
                parentEmail: p.parentEmail,
                parentPhoneNumber: p.parentPhoneNumber,
                relationToChild,
                howDidYouHear,
              },
              { where: { id: p.id }, transaction }
            );

            if (!adminSynced && Number.isInteger(parentAdminId)) {
              DEBUG && console.log("🔄 Syncing Admin ID:", parentAdminId);

              await Admin.update(
                {
                  firstName: p.parentFirstName,
                  lastName: p.parentLastName,
                  phoneNumber: p.parentPhoneNumber,
                },
                { where: { id: parentAdminId }, transaction }
              );

              adminSynced = true;
            }
          } else {
            DEBUG && console.log("🟢 Creating new parent meta");

            if (!p.studentId) {
              DEBUG && console.log("⚠️ Skipping parent (no studentId)");
              continue;
            }

            await HolidayBookingParentMeta.create(
              {
                studentId: p.studentId,
                parentFirstName: p.parentFirstName,
                parentLastName: p.parentLastName,
                parentEmail: p.parentEmail,
                parentPhoneNumber: p.parentPhoneNumber,
                relationToChild,
                howDidYouHear,
              },
              { transaction }
            );
          }
        }
      }

      // ========================
      // 3️⃣ EMERGENCY CONTACTS
      // ========================
      if (Array.isArray(data.emergencyContacts)) {
        DEBUG && console.log("🧪 STEP 5: EMERGENCY LOOP for bookingId", booking.id);

        for (const e of data.emergencyContacts) {
          DEBUG && console.log("➡️ Emergency payload:", e);

          if (Number.isInteger(e.id)) {
            await HolidayBookingEmergencyMeta.update(
              {
                emergencyFirstName: e.emergencyFirstName,
                emergencyLastName: e.emergencyLastName,
                emergencyPhoneNumber: e.emergencyPhoneNumber,
                emergencyRelation: e.emergencyRelation,
              },
              { where: { id: e.id }, transaction }
            );
          }
        }
      }
    }

    await transaction.commit();
    DEBUG && console.log("✅ STEP 6: TRANSACTION COMMITTED");

    return {
      success: true,
      message: "Holiday camp bookings updated successfully",
      details: {
        addedStudents: totalAddedStudents,
        totalBookings: bookings.length,
      }
    };
  } catch (error) {
    await transaction.rollback();
    console.error("❌ updateHolidayBookingsForParent Error:", error.message);
    throw error;
  }
};

// exports.updateHolidayBookingById = async (
//     bookingId,
//     data,
//     { parentAdminId } // role is always Parent here
// ) => {
//     const transaction = await sequelize.transaction();

//     try {
//         const whereClause = {
//             id: bookingId,
//         };

//         if (Number.isInteger(parentAdminId)) {
//             whereClause.parentAdminId = parentAdminId;
//         }
//         const booking = await HolidayBooking.findOne({
//             where: whereClause,
//             include: [
//                 {
//                     model: HolidayBookingStudentMeta,
//                     as: "students",
//                     include: [
//                         { model: HolidayBookingParentMeta, as: "parents" },
//                         { model: HolidayBookingEmergencyMeta, as: "emergencyContacts" }
//                     ]
//                 }
//             ],
//             transaction
//         });

//         if (!booking) throw new Error("Booking not found");

//         const classSchedule = await HolidayClassSchedule.findByPk(
//             booking.classScheduleId,
//             { transaction }
//         );
//         if (!classSchedule) throw new Error("Class schedule not found");

//         let addedStudentsCount = 0;

//         // ========================
//         // 1️⃣ STUDENTS
//         // ========================
//         if (Array.isArray(data.students)) {
//             for (const student of data.students) {

//                 // 🟢 UPDATE existing student
//                 if (Number.isInteger(student.id)) {
//                     await HolidayBookingStudentMeta.update(
//                         {
//                             studentFirstName: student.studentFirstName,
//                             studentLastName: student.studentLastName,
//                             dateOfBirth: student.dateOfBirth,
//                             age: student.age,
//                             gender: student.gender,
//                             medicalInformation: student.medicalInformation,
//                         },
//                         { where: { id: student.id }, transaction }
//                     );
//                 }

//                 // 🟢 CREATE new student
//                 else {
//                     if (classSchedule.capacity < 1) {
//                         throw new Error(
//                             `No capacity available. Remaining: ${classSchedule.capacity}`
//                         );
//                     }

//                     await HolidayBookingStudentMeta.create(
//                         {
//                             bookingId: booking.id,
//                             studentFirstName: student.studentFirstName,
//                             studentLastName: student.studentLastName,
//                             dateOfBirth: student.dateOfBirth,
//                             age: student.age,
//                             gender: student.gender,
//                             medicalInformation: student.medicalInformation,
//                         },
//                         { transaction }
//                     );

//                     addedStudentsCount++;
//                     classSchedule.capacity -= 1;
//                     await classSchedule.save({ transaction });
//                 }
//             }
//         }

//         // ========================
//         // 2️⃣ PARENTS (UPDATE + SYNC ADMIN)
//         // ========================
//         if (Array.isArray(data.parents)) {
//             let adminSynced = false;

//             for (const p of data.parents) {

//                 const relationToChild = p.relationToChild || p.relationChild;
//                 const howDidYouHear = p.howDidYouHear || p.howDidHear;

//                 // 🟢 UPDATE existing parent
//                 if (Number.isInteger(p.id)) {
//                     await HolidayBookingParentMeta.update(
//                         {
//                             parentFirstName: p.parentFirstName,
//                             parentLastName: p.parentLastName,
//                             parentEmail: p.parentEmail,
//                             parentPhoneNumber: p.parentPhoneNumber,
//                             relationToChild,
//                             howDidYouHear,
//                         },
//                         { where: { id: p.id }, transaction }
//                     );

//                     // 🔄 Sync Admin ONCE
//                     if (!adminSynced && Number.isInteger(parentAdminId)) {
//                         await Admin.update(
//                             {
//                                 firstName: p.parentFirstName,
//                                 lastName: p.parentLastName,
//                                 phoneNumber: p.parentPhoneNumber,
//                             },
//                             { where: { id: parentAdminId }, transaction }
//                         );
//                         adminSynced = true;
//                     }
//                 }

//                 // 🟢 CREATE new parent
//                 else {
//                     if (!p.studentId) continue;

//                     await HolidayBookingParentMeta.create(
//                         {
//                             studentId: p.studentId,
//                             parentFirstName: p.parentFirstName,
//                             parentLastName: p.parentLastName,
//                             parentEmail: p.parentEmail,
//                             parentPhoneNumber: p.parentPhoneNumber,
//                             relationToChild,
//                             howDidYouHear,
//                         },
//                         { transaction }
//                     );
//                 }
//             }
//         }

//         // ========================
//         // 3️⃣ EMERGENCY CONTACTS
//         // ========================
//         if (Array.isArray(data.emergencyContacts)) {
//             for (const e of data.emergencyContacts) {
//                 // 🟢 UPDATE
//                 if (Number.isInteger(e.id)) {
//                     await HolidayBookingEmergencyMeta.update(
//                         {
//                             emergencyFirstName: e.emergencyFirstName,
//                             emergencyLastName: e.emergencyLastName,
//                             emergencyPhoneNumber: e.emergencyPhoneNumber,
//                             emergencyRelation: e.emergencyRelation,
//                         },
//                         { where: { id: e.id }, transaction }
//                     );
//                 }
//             }
//         }

//         await transaction.commit();

//         return {
//             success: true,
//             message: "Holiday camp booking updated successfully",
//             details: {
//                 addedStudents: addedStudentsCount,
//                 totalStudents: booking.totalStudents,
//             }
//         };

//     } catch (error) {
//         await transaction.rollback();
//         console.error("❌ updateHolidayBookingById Error:", error.message);
//         throw error;
//     }
// };

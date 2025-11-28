const {
  Venue,
  ClassSchedule,
  PaymentPlan,
  Term,
  TermGroup,
  SessionPlanGroup,
  PaymentGroup,
  PaymentGroupHasPlan,
  SessionExercise,
} = require("../../../models");

const { Op, Sequelize } = require("sequelize");

const parseSessionPlanGroupLevels = async (spg) => {
  if (!spg?.levels) return spg;

  let parsedLevels = {};
  try {
    parsedLevels =
      typeof spg.levels === "string" ? JSON.parse(spg.levels) : spg.levels;
  } catch {
    parsedLevels = {};
  }

  // Collect all unique sessionExerciseIds
  const allIds = new Set();
  Object.values(parsedLevels).forEach((levelArray) => {
    if (Array.isArray(levelArray)) {
      levelArray.forEach((item) => {
        if (Array.isArray(item.sessionExerciseId)) {
          item.sessionExerciseId.forEach((id) => allIds.add(id));
        }
      });
    }
  });

  // Fetch all related session exercises
  const exercises = await SessionExercise.findAll({
    where: { id: [...allIds] },
    attributes: ["id", "title", "description", "imageUrl", "duration"],
  });

  const exerciseMap = {};
  exercises.forEach((ex) => {
    exerciseMap[ex.id] = ex;
  });

  // Attach corresponding exercises directly after sessionExerciseId array
  Object.values(parsedLevels).forEach((levelArray) => {
    if (Array.isArray(levelArray)) {
      levelArray.forEach((item) => {
        if (Array.isArray(item.sessionExerciseId)) {
          item.sessionExercises = item.sessionExerciseId
            .map((id) => exerciseMap[id])
            .filter(Boolean);
        }
      });
    }
  });

  spg.dataValues.levels = parsedLevels;
  return spg;
};

function parseSafeArray(value) {
  if (!value) return [];
  try {
    return typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    return [];
  }
}

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

exports.getAllVenuesWithClasses = async ({
  userLatitude,
  userLongitude,
  searchRadiusMiles,
  createdBy
}) => {
  try {

    if (!createdBy || isNaN(Number(createdBy))) {
      return {
        status: false,
        message: "No valid super admin found for this request.",
        data: [],
      };
    }

    let venues;
    const hasCoordinates =
      typeof userLatitude === "number" && typeof userLongitude === "number";

    if (hasCoordinates) {
      console.log("✅ User coordinates provided:", { userLatitude, userLongitude, searchRadiusMiles });
    } else {
      console.log("⚠️ User coordinates missing. Distance will not be calculated.");
    }

    // let venues;
    // const hasCoordinates =
    //   typeof userLatitude === "number" && typeof userLongitude === "number";

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

      venues = await Venue.findAll({
        where: {
          createdBy: Number(createdBy), // ✅ filter only super admin data
          ...whereCondition
        },
        attributes: {
          include: [[distanceFormula, "distanceMiles"]],
        },
        include: [
          {
            model: ClassSchedule,
            as: "classSchedules",
            required: true, // ✅ Only include venues that HAVE classes
          },
        ],
        order: [[Sequelize.col("distanceMiles"), "DESC"]],
      });
    } else {
      venues = await Venue.findAll({
        where: { createdBy: Number(createdBy) }, // ✅ only super admin’s venues
        include: [
          {
            model: ClassSchedule,
            as: "classSchedules",
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
        if (!venue.classSchedules || venue.classSchedules.length === 0) {
          return null;
        }

        const paymentGroups =
          venue.paymentGroupId != null
            ? await PaymentGroup.findAll({
              where: {
                id: venue.paymentGroupId,
                createdBy: Number(createdBy) // ✅ filter by super admin
              },
              include: [
                {
                  model: PaymentPlan,
                  as: "paymentPlans",
                  through: {
                    model: PaymentGroupHasPlan,
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

        let termGroupIds = [];
        if (typeof venue.termGroupId === "string") {
          try {
            termGroupIds = JSON.parse(venue.termGroupId);
          } catch {
            termGroupIds = [];
          }
        } else if (Array.isArray(venue.termGroupId)) {
          termGroupIds = venue.termGroupId;
        }

        const termGroups = termGroupIds.length
          ? await TermGroup.findAll({
            where: {
              id: termGroupIds,
              createdBy: Number(createdBy) // ✅ filter by super admin
            }
          })
          : [];

        const terms = termGroupIds.length
          ? await Term.findAll({
            where: {
              termGroupId: { [Op.in]: termGroupIds },
              createdBy: Number(createdBy) // ✅ filter by super admin
            },
            attributes: [
              "id",
              "termName",
              "day",
              "startDate",
              "endDate",
              "termGroupId",
              "exclusionDates",
              "totalSessions",
              "sessionsMap",
            ],
          })
          : [];

        const parsedTerms = terms.map((t) => ({
          id: t.id,
          name: t.termName,
          day: t.day,
          startDate: t.startDate,
          endDate: t.endDate,
          termGroupId: t.termGroupId,
          exclusionDates:
            typeof t.exclusionDates === "string"
              ? JSON.parse(t.exclusionDates)
              : t.exclusionDates || [],
          totalSessions: t.totalSessions,
          sessionsMap:
            typeof t.sessionsMap === "string"
              ? JSON.parse(t.sessionsMap)
              : t.sessionsMap || [],
        }));

        const venueClasses = (venue.classSchedules || []).reduce((acc, cls) => {
          const day = cls.day;
          if (!day) return acc;
          if (!acc[day]) acc[day] = [];
          acc[day].push({
            classId: cls.id,
            className: cls.className,
            time: `${cls.startTime} - ${cls.endTime}`,
            capacity: cls.capacity,
            totalCapacity: cls.totalCapacity,
            allowFreeTrial: !!cls.allowFreeTrial,
          });
          return acc;
        }, {});

        const venueLat = parseFloat(venue.latitude);
        const venueLng = parseFloat(venue.longitude);
        // const distanceMiles =
        //   hasCoordinates && !isNaN(venueLat) && !isNaN(venueLng)
        //     ? parseFloat(
        //       calculateDistance(
        //         userLatitude,
        //         userLongitude,
        //         venueLat,
        //         venueLng
        //       ).toFixed(1)
        //     )
        //     : null;

        const distanceMiles =
          !isNaN(venueLat) &&
            !isNaN(venueLng) &&
            typeof userLatitude === "number" &&
            typeof userLongitude === "number"
            ? parseFloat(calculateDistance(userLatitude, userLongitude, venueLat, venueLng).toFixed(1))
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
            paymentPlans: (pg.paymentPlans || []).map((plan) => ({
              id: plan.id,
              title: plan.title,
              price: plan.price,
              priceLesson: plan.priceLesson,
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
          termGroups: termGroups.map((group) => ({
            id: group.id,
            name: group.name,
          })),
          terms: parsedTerms,
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

exports.getAllClasses = async (adminId) => {
  try {

    const classes = await ClassSchedule.findAll({
      order: [["id", "DESC"]],
      include: [
        {
          model: Venue,
          as: "venue",
          required: false, // optional — keeps classes even without a venue
        },
      ],
    });

    for (const cls of classes) {
      const venue = cls.venue;

      let termGroupIds = Array.isArray(venue.termGroupId)
        ? venue.termGroupId
        : typeof venue.termGroupId === "string"
          ? JSON.parse(venue.termGroupId || "[]")
          : [];

      let paymentPlanIds = Array.isArray(venue.paymentPlanId)
        ? venue.paymentPlanId
        : typeof venue.paymentPlanId === "string"
          ? JSON.parse(venue.paymentPlanId || "[]")
          : [];

      if (termGroupIds.length) {
        const termGroups = await TermGroup.findAll({
          where: { id: termGroupIds },
          include: [{ model: Term, as: "terms" }],
        });

        for (const group of termGroups) {
          for (const term of group.terms) {
            if (typeof term.exclusionDates === "string") {
              term.dataValues.exclusionDates = JSON.parse(
                term.exclusionDates || "[]"
              );
            }

            let parsedMap =
              typeof term.sessionsMap === "string"
                ? JSON.parse(term.sessionsMap || "[]")
                : term.sessionsMap || [];

            for (let i = 0; i < parsedMap.length; i++) {
              const entry = parsedMap[i];
              if (!entry.sessionPlanId) continue;

              const spg = await SessionPlanGroup.findByPk(entry.sessionPlanId, {
                attributes: [
                  "id",
                  "groupName",
                  "levels",
                  "beginner_video",
                  "intermediate_video",
                  "advanced_video",
                  "pro_video",
                  "banner",
                  "player",
                  "beginner_upload",
                  "intermediate_upload",
                  "pro_upload",
                  "advanced_upload",
                ],
              });

              entry.sessionPlan = spg
                ? await parseSessionPlanGroupLevels(spg)
                : null;
            }

            term.dataValues.sessionsMap = parsedMap;
          }
        }

        venue.dataValues.termGroups = termGroups;
      }

      if (paymentPlanIds.length) {
        const paymentPlans = await PaymentPlan.findAll({
          where: { id: paymentPlanIds },
        });
        venue.dataValues.paymentPlans = paymentPlans;
      }
    }

    return { status: true, data: classes };
  } catch (error) {
    console.error("❌ getAllClasses Error:", error.message);
    return { status: false, message: error.message };
  }
};

exports.getClassById = async (classId, createdBy) => {
  try {
    const cls = await ClassSchedule.findOne({
      where: {
        id: classId,              // ✅ filter by class ID
        createdBy: Number(createdBy) // ✅ filter by admin/super admin
      },
      include: [{ model: Venue, as: "venue", where: { createdBy: Number(createdBy) } }], // ✅ ensure venue belongs to admin
    });

    if (!cls) {
      return { status: false, message: "Class not found." };
    }

    const venue = cls.venue;

    // =====================
    // Parse termGroupId → array
    // =====================
    let termGroupIds = [];
    if (typeof venue.termGroupId === "string") {
      try { termGroupIds = JSON.parse(venue.termGroupId); } catch { termGroupIds = []; }
    } else if (Array.isArray(venue.termGroupId)) {
      termGroupIds = venue.termGroupId;
    }

    // =====================
    // Fetch termGroups with nested terms & sessions
    // =====================
    let termGroups = [];
    if (termGroupIds.length) {
      termGroups = await TermGroup.findAll({
        where: {
          id: termGroupIds,
          createdBy: Number(createdBy) // ✅ filter by admin
        },
        include: [{ model: Term, as: "terms" }],
      });

      for (const group of termGroups) {
        for (const term of group.terms || []) {
          // Parse exclusionDates
          if (typeof term.exclusionDates === "string") {
            term.dataValues.exclusionDates = JSON.parse(term.exclusionDates || "[]");
          }

          // Parse sessionsMap
          let parsedMap = typeof term.sessionsMap === "string"
            ? JSON.parse(term.sessionsMap || "[]")
            : term.sessionsMap || [];

          // Enrich sessionPlan data
          for (const entry of parsedMap) {
            if (!entry.sessionPlanId) continue;

            const spg = await SessionPlanGroup.findByPk(entry.sessionPlanId, {
              attributes: [
                "id", "groupName", "levels",
                "beginner_video", "intermediate_video", "advanced_video", "pro_video",
                "banner", "player", "beginner_upload", "intermediate_upload", "pro_upload", "advanced_upload",
              ],
            });

            entry.sessionPlan = spg ? await parseSessionPlanGroupLevels(spg) : null;
          }

          term.dataValues.sessionsMap = parsedMap;
        }
      }

      venue.dataValues.termGroups = termGroups;
    }

    // =====================
    // Fetch paymentGroups with nested paymentPlans
    // =====================
    let paymentGroups = [];
    if (venue.paymentGroupId) {
      paymentGroups = await PaymentGroup.findAll({
        where: {
          id: venue.paymentGroupId,
          createdBy: Number(createdBy) // ✅ only super admin’s payment groups
        },
        include: [
          {
            model: PaymentPlan,
            as: "paymentPlans",
            through: {
              model: PaymentGroupHasPlan,
              attributes: ["id", "payment_plan_id", "payment_group_id", "createdBy", "createdAt", "updatedAt"],
            },
          },
        ],
        order: [["createdAt", "DESC"]],
      });
    }
    venue.dataValues.paymentGroups = paymentGroups;

    return { status: true, message: "Class and full details fetched successfully.", data: cls };
  } catch (error) {
    console.error("❌ getClassById Error:", error.message);
    return { status: false, message: "Fetch failed: " + error.message };
  }
};

// exports.getAllVenuesWithClasses = async ({ userLat, userLng, createdBy }) => {
//   try {
//     // ✅ Default location if user coords not provided
//     const currentLat = userLat ?? 51.5;
//     const currentLng = userLng ?? -0.1;

//     const venues = await Venue.findAll({
//       where: {
//         ...(createdBy ? { createdBy } : {}),
//       },
//       include: [
//         {
//           model: ClassSchedule,
//           as: "classSchedules",
//           required: false,
//         },
//         {
//           model: PaymentPlan,
//           as: "paymentPlan",
//           required: false,
//           attributes: [
//             "id",
//             "title",
//             "price",
//             "interval",
//             "students",
//             "duration",
//             "joiningFee",
//             "HolidayCampPackage",
//             "termsAndCondition",
//           ],
//         },
//       ],
//       order: [["id", "ASC"]],
//     });

//     if (!venues || venues.length === 0) {
//       return { status: true, data: [] };
//     }

//     const formattedVenues = await Promise.all(
//       venues.map(async (venue) => {
//         const safeParse = (val) => {
//           if (!val) return null;
//           try {
//             return typeof val === "string" ? JSON.parse(val) : val;
//           } catch {
//             return null;
//           }
//         };

//         // ✅ Parse related IDs
//         const paymentPlanIds = parseSafeArray(venue.paymentPlanId);
//         const termGroupIds = parseSafeArray(venue.termGroupId);

//         // ✅ Fetch related payment plans & terms
//         const paymentPlans = await PaymentPlan.findAll({
//           where: { id: { [Op.in]: paymentPlanIds } },
//         });

//         const termGroups = await TermGroup.findAll({
//           where: { id: { [Op.in]: termGroupIds } },
//         });

//         const terms = await Term.findAll({
//           where: { termGroupId: { [Op.in]: termGroupIds } },
//           attributes: [
//             "id",
//             "termName",
//             "startDate",
//             "endDate",
//             "termGroupId",
//             "exclusionDates",
//             "totalSessions",
//             "sessionsMap",
//           ],
//         });

//         const parsedTerms = terms.map((t) => ({
//           id: t.id,
//           name: t.termName,
//           startDate: t.startDate,
//           endDate: t.endDate,
//           termGroupId: t.termGroupId,
//           exclusionDates: safeParse(t.exclusionDates),
//           totalSessions: t.totalSessions,
//           sessionsMap: safeParse(t.sessionsMap) || [],
//         }));

//         // ✅ Prepare class list
//         const venueClasses = venue.classSchedules.reduce((acc, cls) => {
//           const day = cls.day; // Use day exactly as stored: "Monday", "Sunday", etc.
//           if (!day) return acc;

//           if (!acc[day]) acc[day] = [];

//           acc[day].push({
//             classId: cls.id,
//             className: cls.className,
//             time: `${cls.startTime} - ${cls.endTime}`,
//             capacity: cls.capacity,
//             allowFreeTrial: !!cls.allowFreeTrial,
//           });

//           return acc;
//         }, {});

//         // ✅ Distance Calculation
//         const venueLat = parseFloat(venue.latitude);
//         const venueLng = parseFloat(venue.longitude);
//         const distanceMiles =
//           !isNaN(venueLat) && !isNaN(venueLng)
//             ? parseFloat(
//                 calculateDistance(
//                   currentLat,
//                   currentLng,
//                   venueLat,
//                   venueLng
//                 ).toFixed(1)
//               )
//             : null;

//         return {
//           venueId: venue.id,
//           venueName: venue.name,
//           area: venue.area,
//           address: venue.address,
//           facility: venue.facility,
//           congestionNote: venue.congestionNote,
//           parkingNote: venue.parkingNote,
//           latitude: venue.latitude,
//           longitude: venue.longitude,
//           createdAt: venue.createdAt,
//           postal_code: venue.postal_code,
//           distanceMiles,
//           classes: venueClasses, // ✅ Grouped by day
//           paymentPlans: paymentPlans.map((plan) => ({
//             id: plan.id,
//             title: plan.title,
//             price: plan.price,
//             interval: plan.interval,
//             students: plan.students,
//             duration: plan.duration,
//             joiningFee: plan.joiningFee,
//             holidayCampPackage: plan.HolidayCampPackage,
//             termsAndCondition: plan.termsAndCondition,
//           })),
//           termGroups: termGroups.map((group) => ({
//             id: group.id,
//             name: group.name,
//           })),
//           terms: parsedTerms,
//         };
//       })
//     );

//     return { status: true, data: formattedVenues };
//   } catch (error) {
//     console.error("❌ getAllVenuesWithClasses Error:", error);
//     return {
//       status: false,
//       message: error.message || "Failed to fetch class listings",
//     };
//   }
// };

// ✅ SINGLE VENUE SERVICE
// exports.getVenueWithClassesById = async (venueId, onlyAvailable) => {
//   try {
//     const venues = await Venue.findAll({
//       where: { id: venueId },
//       include: [
//         { model: ClassSchedule, as: "classSchedules", required: false },
//         {
//           model: PaymentPlan,
//           as: "paymentPlan",
//           required: false,
//           attributes: [
//             "id",
//             "title",
//             "price",
//             "interval",
//             "duration",
//             "joiningFee",
//             "HolidayCampPackage",
//             "termsAndCondition",
//           ],
//         },
//         {
//           model: Term,
//           as: "term",
//           required: false,
//           include: [
//             {
//               model: SessionPlanGroup,
//               as: "sessionPlanGroup",
//               required: false,
//             },
//           ],
//         },
//       ],
//     });

//     if (!venues.length) {
//       return { status: false, message: `No venue found with ID ${venueId}` };
//     }

//     const venue = venues[0];

//     // ✅ Inline Safe JSON parse
//     const safeParse = (val) => {
//       if (!val) return null;
//       try {
//         return typeof val === "string" ? JSON.parse(val) : val;
//       } catch (err) {
//         console.warn("⚠️ Failed to parse JSON:", val);
//         return null;
//       }
//     };

//     const plan = venue.paymentPlan;
//     const term = venue.term;
//     const sessionPlan = term?.sessionPlanGroup;
//     const parsedLevels = sessionPlan?.levels
//       ? safeParse(sessionPlan.levels)
//       : null;

//     const venueClasses = venue.classSchedules
//       .map((cls) => {
//         const isFull =
//           cls.capacity === 0 ||
//           cls.capacity === null ||
//           cls.capacity === undefined;

//         return {
//           classId: cls.id,
//           className: cls.className,
//           day: cls.day,
//           time: `${cls.startTime} - ${cls.endTime}`,
//           capacity: cls.capacity,
//           status: isFull ? "Fully Booked" : `${cls.capacity} spaces`,
//           allowFreeTrial: cls.allowFreeTrial,
//           available: !isFull,
//           price: plan ? `${plan.price} (${plan.interval})` : "TBD",
//           term: term
//             ? {
//                 termName: term.termName,
//                 startDate: term.startDate,
//                 endDate: term.endDate,
//                 exclusionDates: term.exclusionDates,
//                 totalSessions: term.totalSessions,
//                 sessionPlanGroup: sessionPlan
//                   ? {
//                       groupName: sessionPlan.groupName,
//                       sortOrder: sessionPlan.sortOrder,
//                       levels: parsedLevels, // ✅ parsed
//                       beginner_banner: sessionPlan.beginner_banner,
//                       beginner_video: sessionPlan.beginner_video,
//                       intermediate_banner: sessionPlan.intermediate_banner,
//                       intermediate_video: sessionPlan.intermediate_video,
//                       pro_banner: sessionPlan.pro_banner,
//                       pro_video: sessionPlan.pro_video,
//                       advanced_banner: sessionPlan.advanced_banner,
//                       advanced_video: sessionPlan.advanced_video,
//                     }
//                   : null,
//               }
//             : null,
//         };
//       })
//       .filter((cls) => (onlyAvailable ? cls.available : true));

//     return {
//       status: true,
//       data: {
//         venueId: venue.id,
//         venueName: venue.name,
//         area: venue.area,
//         address: venue.address,
//         facility: venue.facility,
//         congestionNote: venue.congestionNote,
//         parkingNote: venue.parkingNote,
//         paymentPlan: plan
//           ? {
//               id: plan.id,
//               title: plan.title,
//               price: plan.price,
//               interval: plan.interval,
//               duration: plan.duration,
//               joiningFee: plan.joiningFee,
//               holidayCampPackage: plan.HolidayCampPackage,
//               termsAndCondition: plan.termsAndCondition,
//             }
//           : null,
//         classes: venueClasses,
//       },
//     };
//   } catch (error) {
//     console.error("❌ getVenueWithClassesById Error:", error);
//     return { status: false, message: "Failed to fetch venue class listing" };
//   }
// };

// exports.getAllTermsForListing = async () => {
//   try {
//     const terms = await Term.findAll({
//       order: [["createdAt", "DESC"]],
//       include: [
//         {
//           model: SessionPlanGroup,
//           as: "sessionPlanGroup",
//           attributes: [
//             "id",
//             "groupName",
//             "sortOrder",
//             "levels",
//             "beginner_banner",
//             "beginner_video",
//             "intermediate_banner",
//             "intermediate_video",
//             "advanced_banner",
//             "advanced_video",
//             "pro_banner",
//             "pro_video",
//             "createdAt",
//             "updatedAt",
//           ],
//         },
//       ],
//     });

//     // ✅ Parse JSON fields safely
//     const safeParse = (val, fallback = []) => {
//       if (!val) return fallback;
//       try {
//         return typeof val === "string" ? JSON.parse(val) : val;
//       } catch {
//         return fallback;
//       }
//     };

//     const formattedTerms = terms.map((term) => {
//       const parsedSessionsMap = safeParse(term.sessionsMap, []);
//       const parsedExclusionDates = safeParse(term.exclusionDates, []);

//       return {
//         id: term.id,
//         termName: term.termName,
//         startDate: term.startDate,
//         endDate: term.endDate,
//         exclusionDates: parsedExclusionDates,
//         totalSessions: term.totalSessions,
//         sessionsMap: parsedSessionsMap, // ✅ now proper array, NOT string
//         createdAt: term.createdAt,
//         updatedAt: term.updatedAt,
//         sessionPlanGroup: term.sessionPlanGroup
//           ? {
//               id: term.sessionPlanGroup.id,
//               groupName: term.sessionPlanGroup.groupName,
//               sortOrder: term.sessionPlanGroup.sortOrder,
//               beginner_banner: term.sessionPlanGroup.beginner_banner,
//               beginner_video: term.sessionPlanGroup.beginner_video,
//               intermediate_banner: term.sessionPlanGroup.intermediate_banner,
//               intermediate_video: term.sessionPlanGroup.intermediate_video,
//               advanced_banner: term.sessionPlanGroup.advanced_banner,
//               advanced_video: term.sessionPlanGroup.advanced_video,
//               pro_banner: term.sessionPlanGroup.pro_banner,
//               pro_video: term.sessionPlanGroup.pro_video,
//               levels: safeParse(term.sessionPlanGroup.levels, {}),
//             }
//           : null,
//       };
//     });

//     return { status: true, data: formattedTerms };
//   } catch (error) {
//     console.error("❌ getAllTermsForListing Error:", error.message);
//     return {
//       status: false,
//       message: "Failed to fetch terms. " + error.message,
//     };
//   }
// };

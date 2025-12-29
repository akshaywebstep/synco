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
} = require("../../../../models");

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
async function getCoordinatesFromPostcode(postcode) {
  if (!postcode || typeof postcode !== "string" || postcode.trim().length < 3) {
    console.warn("⚠️ Invalid postcode:", postcode);
    return null;
  }

  const cleanedPostcode = postcode.trim().replace(/\s+/g, ""); // remove spaces
  const username = "akshaywebstep"; // your GeoNames username

  try {
    const res = await axios.get(
      "http://api.geonames.org/postalCodeSearchJSON",
      {
        params: {
          postalcode: cleanedPostcode,
          maxRows: 1,
          username,
        },
        timeout: 10000,
      }
    );

    if (res.data?.postalCodes?.length > 0) {
      const place = res.data.postalCodes[0];

      return {
        latitude: parseFloat(place.lat),
        longitude: parseFloat(place.lng),
        city: place.placeName || null,
        state: place.adminName1 || null,
        country: place.countryCode || null,
        raw: place,
      };
    }
  } catch (err) {
    console.error("❌ GeoNames API error:", err.message);
  }

  console.warn("⚠️ No coordinates found for:", postcode);
  return null;
}

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
  venueName,
  postal_code,
}) => {
  try {
    // ---------- VENUE FILTERS ----------
    const venueWhere = {};

    if (venueName) {
      venueWhere.name = {
        [Op.like]: `%${venueName}%`,
      };
    }

    if (postal_code) {
      venueWhere.postal_code = postal_code;
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
          ...venueWhere, 
          ...whereCondition,
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
        order: [
          ["createdAt", "DESC"],          // newest venues first
          [Sequelize.col("distanceMiles"), "ASC"], // optional: closest first
        ],
      });
    } else {
      venues = await Venue.findAll({
        where: venueWhere,
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

        // ---------- PAYMENT GROUPS ----------
        const paymentGroups =
          venue.paymentGroupId != null
            ? await PaymentGroup.findAll({
              where: {
                id: venue.paymentGroupId,
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

        // ---------- PARSE TERM GROUP IDS ----------
        let termGroupIds = [];
        if (typeof venue.termGroupId === "string") {
          try {
            termGroupIds = JSON.parse(venue.termGroupId || "[]");
          } catch {
            termGroupIds = [];
          }
        } else if (Array.isArray(venue.termGroupId)) {
          termGroupIds = venue.termGroupId;
        }

        // ---------- LOAD TERM GROUPS ----------
        const termGroups = termGroupIds.length
          ? await TermGroup.findAll({
            where: {
              id: termGroupIds,

            },
            attributes: ["id", "name"],
          })
          : [];

        // ---------- LOAD TERMS (DB-side filter) ----------
        const termsFromDb = termGroupIds.length
          ? await Term.findAll({
            where: {
              termGroupId: { [Op.in]: termGroupIds }

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
              "createdBy",
            ],
          })
          : [];

        // ---------- PARSE TERMS & JSON FIELDS ----------
        const parsedTerms = termsFromDb.map((t) => {
          // safe parse helpers
          const parseJSONSafe = (val) => {
            if (val == null) return [];
            if (typeof val === "string") {
              try {
                return JSON.parse(val);
              } catch {
                return [];
              }
            }
            return val;
          };

          return {
            id: t.id,
            name: t.termName,
            day: t.day,
            startDate: t.startDate,
            endDate: t.endDate,
            termGroupId: t.termGroupId,
            exclusionDates: parseJSONSafe(t.exclusionDates),
            totalSessions: t.totalSessions || 0,
            sessionsMap: parseJSONSafe(t.sessionsMap),
            createdBy: t.createdBy,
          };
        });

        // ---------- FILTER TERMS AGAINST LOADED TERM GROUPS ----------
        // This guarantees we only return terms that belong to the termGroups we actually fetched.
        const validGroupIds = new Set(termGroups.map((g) => g.id));
        const filteredTerms = parsedTerms.filter((pt) =>
          validGroupIds.has(pt.termGroupId)
        );

        // ---------- FILTER TERM GROUPS TO ONLY THOSE THAT HAVE TERMS ----------
        const usedTermGroupIds = new Set(filteredTerms.map((t) => t.termGroupId));
        const filteredTermGroups = termGroups.filter((g) =>
          usedTermGroupIds.has(g.id)
        );

        // ---------- CLASS SCHEDULES ----------
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

        // ---------- DISTANCE ----------
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

        // ---------- FINAL RETURN ----------
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
              createdAt: plan.createdAt,
              updatedAt: plan.updatedAt,
              PaymentGroupHasPlan: plan.PaymentGroupHasPlan || null,
            })),
          })),

          termGroups: filteredTermGroups.map((group) => ({
            id: group.id,
            name: group.name,
          })),

          terms: filteredTerms,
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

exports.getClassById = async (classId) => {
  try {
    const cls = await ClassSchedule.findOne({
      where: {
        id: classId,
      },
      include: [{ model: Venue, as: "venue" }], // ✅ ensure venue belongs to admin
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

          // Enrich sessionPlan
          for (const entry of parsedMap) {
            if (!entry.sessionPlanId) continue;

            const spg = await SessionPlanGroup.findByPk(entry.sessionPlanId, {
              attributes: [
                "id", "groupName", "levels",
                "beginner_video", "intermediate_video", "advanced_video", "pro_video",
                "banner", "player",
                "beginner_upload", "intermediate_upload", "pro_upload", "advanced_upload",
              ],
            });

            entry.sessionPlan = spg ? await parseSessionPlanGroupLevels(spg) : null;
          }

          term.dataValues.sessionsMap = parsedMap;
        }
      }
    }

    // --------------------------------------------------
    // 🚨 CHECK EMPTY TERMS (Your requirement)
    // --------------------------------------------------
    let noTerms = false;

    if (!termGroups.length) {
      noTerms = true;
    } else {
      const hasAnyTerms = termGroups.some(g => g.terms && g.terms.length > 0);
      if (!hasAnyTerms) noTerms = true;
    }

    if (noTerms) {
      venue.dataValues.termGroups = [];
      venue.dataValues.noTermsMessage = "This venue does not have any term and dates.";
    } else {
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

// exports.getAllVenues = async () => {
//   try {
//     const venues = await Venue.findAll({
//       order: [["createdAt", "DESC"]],
//       attributes: [
//         "id",
//         "area",
//         "name",
//         "address",
//         "facility",
//         "parkingNote",
//         "howToEnterFacility",
//         "paymentGroupId",
//         "isCongested",
//         "hasParking",
//         "termGroupId",
//         "latitude",
//         "longitude",
//         "postal_code",
//         "createdBy",
//         "createdAt",
//         "updatedAt",
//       ],
//     });

//     return {
//       status: true,
//       message: "Venues fetched successfully.",
//       data: venues,
//     };
//   } catch (error) {
//     console.error("❌ getAllVenues Error:", error);
//     return {
//       status: false,
//       message: "Failed to fetch venues.",
//     };
//   }
// };

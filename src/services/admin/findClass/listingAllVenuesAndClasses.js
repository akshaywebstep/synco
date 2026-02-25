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
  Admin,
  StarterPack,
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
  createdBy,
  adminId
}) => {
  try {

    const currentAdmin = await Admin.findByPk(adminId);

    if (!currentAdmin) {
      return {
        status: false,
        message: "Admin not found.",
        data: [],
      };
    }

    let createdByIds = [];

    // ✅ If SuperAdmin
    if (!currentAdmin.superAdminId) {
      const childAdmins = await Admin.findAll({
        where: { superAdminId: adminId },
        attributes: ["id"],
      });

      const childIds = childAdmins.map(a => a.id);

      // SuperAdmin can see own + franchise venues
      createdByIds = [adminId, ...childIds];
    }
    // ✅ If Franchise
    else {
      createdByIds = [adminId];
    }
    // if (!createdBy || isNaN(Number(createdBy))) {
    //   return {
    //     status: false,
    //     message: "No valid super admin found for this request.",
    //     data: [],
    //   };
    // }

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
          // createdBy: Number(createdBy), // ✅ filter only super admin data
          createdBy: createdByIds, // ✅ SuperAdmin + Franchise support
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
        where: { createdBy: createdByIds }, // ✅ only super admin’s venues
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
                // createdBy: Number(createdBy),
                createdBy: createdByIds,
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
              // createdBy: Number(createdBy),
              createdBy: createdByIds
            },
            attributes: ["id", "name"],
          })
          : [];

        // ---------- LOAD TERMS (DB-side filter) ----------
        const termsFromDb = termGroupIds.length
          ? await Term.findAll({
            where: {
              termGroupId: { [Op.in]: termGroupIds },
              // createdBy: Number(createdBy),
              createdBy: createdByIds
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
          if (!cls.day) return acc;

          // 🔹 same day check (case-insensitive)
          const existingKey = Object.keys(acc).find(
            (k) => k.toLowerCase() === cls.day.toLowerCase()
          );

          // 🔹 jo pehle aaya wahi preserve hoga
          const dayKey = existingKey || cls.day;

          if (!acc[dayKey]) acc[dayKey] = [];

          acc[dayKey].push({
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

        const classDays = Object.keys(venueClasses);
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
          // ✅ ALL DAYS JINME CLASSES HAIN
          days: classDays,
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
exports.getClassById = async (classId, adminId, createdBy) => {
  try {
    const currentAdmin = await Admin.findByPk(adminId);

    if (!currentAdmin) {
      return { status: false, message: "Admin not found." };
    }

    let createdByIds = [];

    // ✅ SuperAdmin
    if (!currentAdmin.superAdminId) {
      const childAdmins = await Admin.findAll({
        where: { superAdminId: adminId },
        attributes: ["id"],
      });

      const childIds = childAdmins.map(a => a.id);

      createdByIds = [adminId, ...childIds];
    }
    // ✅ Franchise
    else {
      createdByIds = [adminId];
    }
    const cls = await ClassSchedule.findOne({
      where: {
        id: classId,              // ✅ filter by class ID
        // createdBy: Number(createdBy) // ✅ filter by admin/super admin
        createdBy: createdByIds
      },
      include: [{ model: Venue, as: "venue", where: { createdBy: createdByIds } }], // ✅ ensure venue belongs to admin
    });

    if (!cls) {
      return { status: false, message: "Class not found." };
    }

    const venue = cls.venue;
    // =====================
    // Fetch enabled starter packs for this venue/admin
    // =====================
    let starterPacks = await StarterPack.findAll({
      where: {
        enabled: true,           // only enabled packs
        createdBy: createdByIds, // only those created by this admin/super admin
      },
      attributes: [
        "id",
        "title",
        "description",
        "price",
        "mandatory",
        "appliesOnTrialConversion",
        "appliesOnDirectMembership",
        "paymentRouting",
      ],
    });

    // =====================
    // Attach starterPack ONLY if exists
    // =====================
    if (starterPacks.length) {
      cls.dataValues.starterPack = starterPacks; // show starter pack if enabled
    }
    // =====================
    // Fetch other classes of SAME venue
    // =====================
    const venueClasses = await ClassSchedule.findAll({
      where: {
        venueId: venue.id,          // ✅ same venue only
        // createdBy: Number(createdBy)
        createdBy: createdByIds
      },
      attributes: [
        "id",
        "className",
        "capacity",
        "startTime",
        "endTime",
        "day",
      ],
    });

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
          // createdBy: Number(createdBy)
          createdBy: createdByIds
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
          // createdBy: Number(createdBy) // ✅ only super admin’s payment groups
          createdBy: createdByIds
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
    cls.dataValues.venueClasses = venueClasses;
    return {
      status: true,
      message: "Class and full details fetched successfully.",
      data: cls
    };
  } catch (error) {
    console.error("❌ getClassById Error:", error.message);
    return { status: false, message: "Fetch failed: " + error.message };
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


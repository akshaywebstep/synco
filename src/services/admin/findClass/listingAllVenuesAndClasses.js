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

const { Op } = require("sequelize");

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

exports.getAllVenuesWithClasses = async ({ userLat, userLng }) => {
  try {
    const currentLat = userLat ?? 51.5;
    const currentLng = userLng ?? -0.1;

    const venues = await Venue.findAll({
      where: {},
      include: [
        {
          model: ClassSchedule,
          as: "classSchedules",
          required: false,
        },
      ],
      order: [["id", "ASC"]],
    });

    if (!venues || venues.length === 0) {
      return { status: true, data: [] };
    }

    const formattedVenues = await Promise.all(
      venues.map(async (venue) => {
        // =====================
        // Parse paymentGroupId → single integer
        // =====================
        const paymentGroups =
          venue.paymentGroupId != null
            ? await PaymentGroup.findAll({
                where: { id: venue.paymentGroupId },
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

        // =====================
        // Parse termGroupId → array
        // =====================
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

        // Fetch termGroups
        const termGroups = termGroupIds.length
          ? await TermGroup.findAll({ where: { id: termGroupIds } })
          : [];

        // Fetch terms
        const terms = termGroupIds.length
          ? await Term.findAll({
              where: { termGroupId: { [Op.in]: termGroupIds } },
              attributes: [
                "id",
                "termName",
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

        // Map class schedules by day
        const venueClasses = (venue.classSchedules || []).reduce((acc, cls) => {
          const day = cls.day;
          if (!day) return acc;
          if (!acc[day]) acc[day] = [];

          acc[day].push({
            classId: cls.id,
            className: cls.className,
            time: `${cls.startTime} - ${cls.endTime}`,
            capacity: cls.capacity,
            allowFreeTrial: !!cls.allowFreeTrial,
          });

          return acc;
        }, {});

        const venueLat = parseFloat(venue.latitude);
        const venueLng = parseFloat(venue.longitude);
        const distanceMiles =
          !isNaN(venueLat) && !isNaN(venueLng)
            ? parseFloat(
                calculateDistance(currentLat, currentLng, venueLat, venueLng).toFixed(1)
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

    return { status: true, data: formattedVenues };
  } catch (error) {
    console.error("❌ getAllVenuesWithClasses Error:", error);
    return {
      status: false,
      message: error.message || "Failed to fetch class listings",
    };
  }
};

const {
    HolidayVenue,
    HolidayClassSchedule,
    HolidayPaymentPlan,
    HolidayCamp,
    HolidayCampDates,
    HolidaySessionPlanGroup,
    HolidayPaymentGroup,
    HolidayPaymentGroupHasPlan,
    HolidaySessionExercise,
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

exports.getAllHolidayVenuesWithHolidayClasses = async ({
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
                    ...whereCondition
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
                where: {
                    createdBy: {
                        [Op.or]: [
                            Number(createdBy),   // superadmin
                            { [Op.ne]: null }    // any admin
                        ]
                    },
                },

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

                // Allow both SuperAdmin & Admin
                const createdByFilter = {
                    [Op.or]: [
                        Number(createdBy),   // superadmin
                        venue.createdBy      // admin who created each venue
                    ]
                };

                // ---------- Payment Groups ----------
                const paymentGroups =
                    venue.paymentGroupId != null
                        ? await HolidayPaymentGroup.findAll({
                            where: {
                                id: venue.paymentGroupId,
                                createdBy: createdByFilter,
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
                            createdBy: createdByFilter,
                        },
                    })
                    : [];

                // ---------- Holiday Camp Dates ----------
                const holidayCampDates = holidayCampIds.length
                    ? await HolidayCampDates.findAll({
                        where: {
                            holidayCampId: { [Op.in]: holidayCampIds },
                            createdBy: createdByFilter,
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

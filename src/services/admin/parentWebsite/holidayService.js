const {
    HolidayVenue,
    HolidayClassSchedule,
    HolidayPaymentPlan,
    HolidayCamp,
    HolidayCampDates,
    HolidayPaymentGroup,
    HolidayPaymentGroupHasPlan,
} = require("../../../models");

const { Op, Sequelize } = require("sequelize");

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

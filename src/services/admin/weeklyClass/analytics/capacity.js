const { Op, Sequelize } = require("sequelize");
const moment = require("moment");
const { Booking, ClassSchedule, Venue, PaymentPlan, Admin, BookingStudentMeta } = require("../../../../models");

const startDate = moment().subtract(1, "year").startOf("year").toDate();
const endDate = moment().endOf("year").toDate();

function applyVenueFilter(where, filters) {
    if (filters?.venueId) {
        where.venueId = filters.venueId;
    }
    return where;
}

// 🔹 Helper: Build admin filter depending on role
async function getAdminFilter(superAdminId, adminId) {
    // ✅ If super admin → all admins under them + self
    if (superAdminId === adminId) {
        const managedAdmins = await Admin.findAll({
            where: { superAdminId },
            attributes: ["id"],
        });

        const adminIds = managedAdmins.map((a) => a.id);
        adminIds.push(superAdminId);
        return adminIds;
    }

    // ✅ Normal admin → only themselves
    return [adminId];
}

async function getTotalCapacity(adminIds, filters = {}) {
    const where = { createdBy: { [Op.in]: adminIds } };

    applyVenueFilter(where, filters);

    const classSchedules = await ClassSchedule.findAll({
        where,
        attributes: ["capacity"],
    });

    return classSchedules.reduce((sum, c) => sum + (c.capacity || 0), 0);
}

// 🔹 Helper: total occupied spaces (confirmed/active)
async function getOccupiedSpaces(periodStart, periodEnd, adminIds, filters = {}) {
    const students = await BookingStudentMeta.findAll({
        include: [
            {
                model: Booking,
                as: "booking",
                required: true,
                where: {
                    status: { [Op.in]: ["active", "not attended", "attended", "pending"] },
                    bookedBy: { [Op.in]: adminIds },
                    ...(periodStart && periodEnd ? { createdAt: { [Op.between]: [periodStart, periodEnd] } } : {})
                },
                attributes: ["id", "createdAt", "paymentPlanId", "bookedBy"]
            }
        ],
        attributes: ["id", "age", "bookingTrialId"]
    });

    // Each row is already a student
    const filtered = students.filter(s => s.age != null && applyFilters(s, filters));

    return filtered.length;
}

// 🔹 Helper: total revenue (from PaymentPlan)
async function getTotalRevenue(periodStart, periodEnd, adminIds, filters = {}) {
    // 🔹 Build proper where clause
    const bookingsWhere = {
        status: { [Op.in]: ["active"] },
        bookedBy: { [Op.in]: adminIds },
        ...(periodStart && periodEnd ? { createdAt: { [Op.between]: [periodStart, periodEnd] } } : {})
    };

    // 🔹 Apply venue filter properly
    applyVenueFilter(bookingsWhere, filters);

    // 🔹 Query bookings
    const bookings = await Booking.findAll({
        where: bookingsWhere,
        include: [
            {
                model: PaymentPlan,
                as: "paymentPlan",
                attributes: ["price"],
                required: true
            },
            {
                model: BookingStudentMeta,
                as: "students",
                attributes: ["age"],
                required: false
            }
        ]
    });

    // 🔹 Flatten students + filter by age/etc.
    const students = bookings.flatMap(b =>
        (b.students || []).map(s => ({ ...s.get(), booking: b }))
    ).filter(s => s.age != null && applyFilters(s, filters));

    // 🔹 Sum revenue
    return students.reduce(
        (sum, s) => sum + (s.booking.paymentPlan?.price || 0),
        0
    );
}

// 🔹 Helper: month-wise capacity trend (current vs previous year)
async function getCapacityMonthWise(superAdminId, filters, adminId) {
    const adminIds = await getAdminFilter(superAdminId, adminId);
    const now = moment();
    const currentYear = now.year();
    const prevYear = currentYear - 1;

    // ✅ Fetch all schedules for current & previous years in one go
    const schedules = await ClassSchedule.findAll({
        where: {
            createdBy: { [Op.in]: adminIds },
            createdAt: {
                [Op.between]: [startDate, endDate],
            },
        },
        attributes: ["capacity", "createdAt"],
    });

    // ✅ Group data by month and year
    const dataByYear = {
        [currentYear]: Array(12).fill(0),
        [prevYear]: Array(12).fill(0),
    };

    schedules.forEach((s) => {
        const year = moment(s.createdAt).year();
        const monthIndex = moment(s.createdAt).month(); // 0–11
        if (dataByYear[year]) {
            dataByYear[year][monthIndex] += s.capacity || 0;
        }
    });

    // ✅ Build structured response (Jan–Dec)
    const monthWise = [];
    for (let i = 0; i < 12; i++) {
        const currentYearCount = dataByYear[currentYear][i] || 0;
        const prevYearCount = dataByYear[prevYear][i] || 0;
        const totalCapacity = currentYearCount + prevYearCount;

        monthWise.push({
            month: moment().month(i).format("MMM"),
            currentYearCount,
            prevYearCount,
            totalCapacity,
            occupancyRate:
                totalCapacity > 0
                    ? `${((currentYearCount / totalCapacity) * 100).toFixed(2)}%`
                    : "0%",
        });
    }

    return { monthWise };
}

// 🔹 High Demand Venues (group by venueId → show venue.address or venue.area)
async function getHighDemandVenue(superAdminId, filters, adminId) {
    const adminIds = await getAdminFilter(superAdminId, adminId);

    const where = {
        bookedBy: { [Op.in]: adminIds },
    };
    applyVenueFilter(where, filters);

    if (filters?.period === "thisMonth") {
        const start = moment().startOf("month").toDate();
        const end = moment().endOf("month").toDate();
        where.createdAt = { [Op.between]: [start, end] };
    }

    const venues = await Booking.findAll({
        where,
        attributes: [
            "venueId",
            [Booking.sequelize.fn("COUNT", Booking.sequelize.col("Booking.id")), "count"],
        ],
        include: [
            {
                model: Venue,
                as: "venue",
                attributes: ["id", "name", "area", "address"],
                where: { deletedAt: null },  // 👈 EXCLUDE soft-deleted venues
                required: true,               // 👈 INNER JOIN (no venue = no result)
            },
        ],
        group: ["venueId", "venue.id", "venue.name", "venue.area", "venue.address"],
        order: [[Booking.sequelize.literal("count"), "DESC"]],
    });

    const totalBookings = venues.reduce((sum, v) => sum + Number(v.getDataValue("count")), 0);

    return venues
        .map(v => {
            const count = Number(v.getDataValue("count"));
            const percentage = totalBookings ? ((count / totalBookings) * 100).toFixed(0) : 0;

            const venue = v.venue;
            const name = venue.name || venue.area || venue.address;

            return {
                venueId: v.venue.id,
                name,
                count,
                percentage: `${percentage}%`,
                value: Number(percentage),
            };
        })
        .sort((a, b) => b.value - a.value)
        .slice(0, 5);
}

async function getCapacityByVenue(superAdminId, filters, adminId) {
    // 1️⃣ Get admin IDs allowed for this query
    const adminIds = await getAdminFilter(superAdminId, adminId);

    // 2️⃣ Build WHERE clause for ClassSchedule
    const where = { createdBy: { [Op.in]: adminIds } };

    if (filters?.period === "thisMonth") {
        const start = moment().startOf("month").toDate();
        const end = moment().endOf("month").toDate();
        where.createdAt = { [Op.between]: [start, end] };
    }

    // 3️⃣ Query venues along with total capacity of their class schedules
    const venues = await Venue.findAll({
        include: [
            {
                model: ClassSchedule,
                as: "classSchedules",
                where,
                attributes: [], // we only need SUM(capacity)
            },
        ],
        attributes: [
            "id",
            "area",
            "address",
            [Sequelize.fn("SUM", Sequelize.col("classSchedules.capacity")), "totalCapacity"],
        ],
        group: ["Venue.id", "Venue.area", "Venue.address"],
        order: [[Sequelize.literal("totalCapacity"), "DESC"]],
    });

    // 4️⃣ Calculate total capacity across all venues
    const totalCapacityAllVenues = venues.reduce(
        (sum, v) => sum + Number(v.getDataValue("totalCapacity") || 0),
        0
    );

    // 5️⃣ Map each venue with percentage relative to total capacity
    const result = venues.map((v) => {
        const total = Number(v.getDataValue("totalCapacity")) || 0;

        // 🔹 Percentage relative to total across all venues
        const percentage = totalCapacityAllVenues
            ? ((total / totalCapacityAllVenues) * 100).toFixed(0)
            : 0;

        const venueName = v.area || v.address || "Unknown Venue";

        return {
            venueId: v.id,
            name: venueName,
            totalCapacity: total,
            percentage: `${percentage}%`,
            value: Number(percentage),
        };
    });

    // 6️⃣ Sort descending by percentage and limit to top 5
    return result.sort((a, b) => b.value - a.value).slice(0, 5);
}

function applyFilters(bookingStudent, filter) {
    let valid = true;
    // 🔹 Define dynamic age groups (numeric code → min/max age)
    const AGE_GROUPS = {
        1: { min: 0, max: 17 },     // under 18
        2: { min: 18, max: 25 },    // 18–25
        3: { min: 26, max: 40 },    // 26–40
        4: { min: 41 },             // 41+
        5: "all"                    // all ages
    };

    // 🔹 Age filter using numeric code
    if (valid && filter.age != null) {
        const age = Number(bookingStudent.age);
        if (isNaN(age)) return false; // safeguard

        const group = AGE_GROUPS[filter.age]; // get age range for code

        if (!group || group === "all") {
            valid = true; // code = 5 → all ages
        } else {
            const { min, max } = group;
            if (min != null && age < min) valid = false;
            if (max != null && age > max) valid = false;
        }
    }

    // Period filter
    if (valid && filter.period) {
        const now = moment();
        const createdAt = bookingStudent.booking?.createdAt;
        if (!createdAt) return false; // safeguard

        const bookingDate = moment(createdAt);

        if (filter.period === "thisMonth") {
            valid = bookingDate.isSame(now, "month");
        } else if (filter.period === "thisQuarter") {
            valid = bookingDate.quarter() === now.quarter();
        } else if (filter.period === "thisYear") {
            valid = bookingDate.isSame(now, "year");
        }
    }

    // Venue filter
    if (valid && filter.venueId) {
        const bookingVenueId = bookingStudent.booking?.venueId;
        valid = bookingVenueId === filter.venueId;
    }

    return valid;

}

async function getVenuesByAdmin(superAdminId, adminId, filters = {}) {
    const adminIds = await getAdminFilter(superAdminId, adminId);

    // --- Base WHERE for Bookings ---
    const where = {
        bookedBy: { [Op.in]: adminIds }
    };

    // 🔹 Apply period filter
    if (filters.period === "thisMonth") {
        where.createdAt = {
            [Op.between]: [
                moment().startOf("month").toDate(),
                moment().endOf("month").toDate()
            ]
        };
    }

    // 🔹 Apply venue filter (if filtering to a single venue)
    if (filters.venueId) {
        where.venueId = filters.venueId;
    }

    // --- Fetch venues that have bookings by these admins ---
    const venues = await Venue.findAll({
        include: [
            {
                model: Booking,
                as: "bookings",
                required: true,
                where,
                attributes: []
            }
        ],
        attributes: ["id", "name", "area", "address"],
        where: {
            deletedAt: null   // ⛔ EXCLUDE soft-deleted venues
        },
        group: ["Venue.id", "Venue.name", "Venue.area", "Venue.address"],
        order: [["name", "ASC"]]
    });

    // --- Format Response ---
    return venues.map(v => ({
        venueId: v.id,
        name: v.name || v.area || v.address || "Unknown Venue"
    }));
}

// 🔹 Membership / Payment Plan Breakdown
async function membershipPlans(superAdminId, filters, adminId) {
    // 1️⃣ Get list of admin IDs to include
    const adminIds = await getAdminFilter(superAdminId, adminId);

    // 2️⃣ Build WHERE clause for Booking
    const where = {
        bookedBy: { [Op.in]: adminIds },
        paymentPlanId: { [Op.ne]: null }, // ✅ Exclude null paymentPlanId
    };
    applyVenueFilter(where, filters);

    // Optional: filter by current month
    if (filters?.period === "thisMonth") {
        const start = moment().startOf("month").toDate();
        const end = moment().endOf("month").toDate();
        where.createdAt = { [Op.between]: [start, end] };
    }

    // 3️⃣ Query Bookings grouped by paymentPlanId
    const plans = await Booking.findAll({
        where,
        attributes: [
            "paymentPlanId",
            [Booking.sequelize.fn("COUNT", Booking.sequelize.col("Booking.id")), "count"],
        ],
        include: [
            {
                model: PaymentPlan,
                as: "paymentPlan", // ✅ Ensure association exists
                attributes: ["id", "title", "price", "interval", "duration"],
            },
        ],
        group: [
            "paymentPlanId",
            "paymentPlan.id",
            "paymentPlan.title",
            "paymentPlan.price",
            "paymentPlan.interval",
            "paymentPlan.duration",
        ],
        order: [[Booking.sequelize.literal("count"), "DESC"]],
    });

    // 4️⃣ Compute total bookings across all plans
    const totalBookings = plans.reduce((sum, p) => sum + Number(p.getDataValue("count")), 0);

    // 5️⃣ Format result for frontend
    const result = plans.map((p) => ({
        paymentPlanId: p.paymentPlanId,
        title: p.paymentPlan?.title || "Unknown Plan",
        price: p.paymentPlan?.price || 0,
        interval: p.paymentPlan?.interval || "N/A",
        duration: p.paymentPlan?.duration || 0,
    }));

    // 6️⃣ Sort and return top 5 plans
    return result.slice(0, 5);
}

async function capacityByClass(superAdminId, filters, adminId) {
    const adminIds = await getAdminFilter(superAdminId, adminId);

    // 1️⃣ Build WHERE clause for ClassSchedule
    const scheduleWhere = { createdBy: { [Op.in]: adminIds } };
    applyVenueFilter(scheduleWhere, filters);

    if (filters?.period === "thisMonth") {
        const start = moment().startOf("month").toDate();
        const end = moment().endOf("month").toDate();
        scheduleWhere.createdAt = { [Op.between]: [start, end] };
    }

    // 2️⃣ Query all classes with total bookings (LEFT JOIN)
    const classes = await ClassSchedule.findAll({
        where: scheduleWhere,
        attributes: [
            "id",
            "className",
            "capacity",
            [Sequelize.fn("COUNT", Sequelize.col("booking.id")), "usedCount"] // Use correct alias
        ],
        include: [
            {
                model: Booking,
                as: "booking", // ✅ Must match model association
                attributes: [],
                where: {
                    bookedBy: { [Op.in]: adminIds },
                    ...(filters?.period === "thisMonth" && {
                        createdAt: {
                            [Op.between]: [
                                moment().startOf("month").toDate(),
                                moment().endOf("month").toDate()
                            ]
                        }
                    }),
                },
                required: false, // LEFT JOIN
            }
        ],
        group: ["ClassSchedule.id"],
        order: [[Sequelize.literal("usedCount"), "DESC"]],
    });

    // 3️⃣ Filter classes if needed
    const filteredClasses = classes.filter(c => (c.capacity || 0) > 0);

    // 4️⃣ Compute total capacity for percentage calculation
    const totalCapacityAll = filteredClasses.reduce(
        (sum, c) => sum + (c.capacity || 0),
        0
    );

    // 5️⃣ Map to final result with percentage relative to total capacity
    const result = filteredClasses.map(c => {
        const capacity = c.capacity;
        const usedCount = Number(c.getDataValue("usedCount") || 0);
        const percentageUsed = totalCapacityAll
            ? ((capacity / totalCapacityAll) * 100).toFixed(0)
            : 0;

        return {
            classScheduleId: c.id,
            className: c.className || "N/A",
            capacity,
            usedCount,
            percentageUsed: `${percentageUsed}%`,
            value: Number(percentageUsed)
        };
    });

    // 6️⃣ Sort descending by percentage and limit top 5
    return result.sort((a, b) => b.value - a.value).slice(0, 5);
}

// 🔹 Main: capacity dashboard summary
async function getCapacityWidgets(superAdminId, filters, adminId) {
    const currentStart = moment().startOf("month").toDate();
    const currentEnd = moment().endOf("month").toDate();
    const prevStart = moment(currentStart).subtract(1, "month").toDate();
    const prevEnd = moment(currentEnd).subtract(1, "month").toDate();

    // ✅ Get list of relevant admin IDs (depending on role)
    const adminIds = await getAdminFilter(superAdminId, adminId);

    // --- Current period ---
    // const totalCapacity = await getTotalCapacity(adminIds);
    const totalCapacity = await getTotalCapacity(adminIds, filters);

    const occupiedCurrent = await getOccupiedSpaces(currentStart, currentEnd, adminIds, filters || {});
    const occupiedPrev = await getOccupiedSpaces(prevStart, prevEnd, adminIds, filters || {});

    // const occupiedCurrent = await getOccupiedSpaces(currentStart, currentEnd, adminIds);
    const revenueCurrent = await getTotalRevenue(currentStart, currentEnd, adminIds, filters);

    // --- Previous period ---
    const revenuePrev = await getTotalRevenue(prevStart, prevEnd, adminIds, filters);

    // --- Derived metrics ---
    const occupancyRate = totalCapacity ? (occupiedCurrent / totalCapacity) * 100 : 0;
    const unfulfilledSpaces = totalCapacity - occupiedCurrent;
    const untappedRevenue =
        revenueCurrent && occupiedCurrent
            ? ((totalCapacity - occupiedCurrent) * (revenueCurrent / occupiedCurrent))
            : 0;

    // --- % changes ---
    const pctChange = (current, prev) =>
        prev > 0 ? (((current - prev) / prev) * 100).toFixed(1) : "0";

    return {
        totalCapacity: {
            count: totalCapacity,
            change: `${pctChange(totalCapacity, totalCapacity * 0.9)}%`,
             vsPrev: Number((totalCapacity * 0.9).toFixed(0)),
        },
        occupancy: {
            count: `£${revenueCurrent.toLocaleString()}`,
            change: `${pctChange(revenueCurrent, revenuePrev)}%`,
            vsPrev: `£${revenuePrev.toLocaleString()}`,
        },
        occupancyRate: {
            count: `${occupancyRate.toFixed(2)}%`,
            change: `${pctChange(occupancyRate, (occupiedPrev / totalCapacity) * 100)}%`,
            vsPrev: `${((occupiedPrev / totalCapacity) * 100).toFixed(2)}%`,
        },
        unfulfilledSpaces: {
            count: unfulfilledSpaces,
            change: `${pctChange(unfulfilledSpaces, totalCapacity - occupiedPrev)}%`,
            vsPrev: totalCapacity - occupiedPrev,
        },
        untappedRevenue: {
            count: `£${untappedRevenue.toFixed(2)}`,
            change: `${pctChange(untappedRevenue, (totalCapacity - occupiedPrev) * (revenuePrev / (occupiedPrev || 1)))}%`,
            vsPrev: `£${((totalCapacity - occupiedPrev) * (revenuePrev / (occupiedPrev || 1))).toFixed(2)}`,
        },
    };
}

module.exports = {
    getCapacityWidgets, getCapacityMonthWise, getHighDemandVenue, getCapacityByVenue, membershipPlans, capacityByClass, getVenuesByAdmin
};

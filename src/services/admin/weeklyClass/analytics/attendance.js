const { Op } = require("sequelize");
const moment = require("moment");
const {
    Booking,
    BookingStudentMeta,
    Venue,
    Admin,
    ClassSchedule,
} = require("../../../../models");

async function getBookingAttendanceAnalytics(superAdminId, filters = {}, adminId = null) {
    const {
        bookedBy,
        createdBy,
        venueId,
        filterByVenue,
        filterByClass,
        filterType,
    } = filters;

    console.log("🔹 Filters received:", filters);

    // 🗓️ Date range filter (use let to allow reassignment)
    let startDate, endDate;
    const now = moment();
    if (filterType === "lastMonth") {
        startDate = moment().subtract(1, "month").startOf("month").toDate();
        endDate = moment().subtract(1, "month").endOf("month").toDate();
    } else if (filterType === "lastYear") {
        startDate = moment().subtract(1, "year").startOf("year").toDate();
        endDate = moment().subtract(1, "year").endOf("year").toDate();
    } else {
        // Default: last 1 year from today
        startDate = moment().subtract(1, "year").startOf("day").toDate();
        endDate = moment().endOf("day").toDate();
    }

    console.log("📅 Date range:", startDate, "-", endDate);

    const whereCondition = {
        createdAt: { [Op.between]: [startDate, endDate] },
    };

    // 👑 Admin access filter
    let adminIds = [];
    if (superAdminId && superAdminId === adminId) {
        const managedAdmins = await Admin.findAll({
            where: { superAdminId },
            attributes: ["id"],
        });
        adminIds = managedAdmins.map((a) => a.id);
        adminIds.push(superAdminId);
        whereCondition.bookedBy = { [Op.in]: adminIds };
        console.log("🧑‍💼 SuperAdmin manages admins:", adminIds);
    } else if (adminId && superAdminId) {
        adminIds = [adminId, superAdminId];
        whereCondition.bookedBy = { [Op.in]: adminIds };
        console.log("🧑‍💼 Admin access for:", adminIds);
    } else if (bookedBy) {
        whereCondition.bookedBy = bookedBy;
        console.log("🧑‍💼 Filter by bookedBy:", bookedBy);
    }

    if (createdBy) whereCondition.createdBy = createdBy;
    if (venueId) whereCondition.venueId = venueId;

    console.log("🔹 Booking WHERE condition:", whereCondition);

    // 🏟️ Include relationships
    const includeConditions = [
        {
            model: BookingStudentMeta,
            as: "students",
            attributes: ["attendance", "age", "gender"],
            where: { attendance: "attended" },
            required: true,
        },
        {
            model: Venue,
            as: "venue",
            required: true,
            attributes: ["id", "name", "createdBy"],
            where: {},
        },
        {
            model: ClassSchedule,
            as: "classSchedule",
            required: true,
            attributes: ["id", "className", "createdBy"],
            where: {},
        },
    ];

    const venueFilterArray = Array.isArray(filterByVenue) ? filterByVenue : filterByVenue ? [filterByVenue] : [];
    const classFilterArray = Array.isArray(filterByClass) ? filterByClass : filterByClass ? [filterByClass] : [];

    if (venueFilterArray.length > 0) includeConditions[1].where.id = { [Op.in]: venueFilterArray };
    if (classFilterArray.length > 0) includeConditions[2].where.id = { [Op.in]: classFilterArray };

    console.log("🏟️ Include conditions:", includeConditions);

    // 🧩 Fetch bookings
    const bookings = await Booking.findAll({
        where: whereCondition,
        include: includeConditions,
    });
    console.log(`📌 Fetched ${bookings.length} bookings`);

    // 🔹 Venues and classes used
    const usedVenueIds = [...new Set(bookings.map((b) => b.venue?.id).filter(Boolean))];
    const allVenues = await Venue.findAll({
        where: { id: usedVenueIds },
        attributes: ["id", "name", "createdBy"],
        order: [["name", "ASC"]],
    });

    const usedClassScheduleIds = [...new Set(bookings.map((b) => b.classSchedule?.id).filter(Boolean))];
    const allClasses = await ClassSchedule.findAll({
        where: { id: usedClassScheduleIds },
        attributes: ["id", "className", "createdBy"],
        order: [["className", "ASC"]],
    });

    // 🔹 Stats initialization
    const allMonths = moment.monthsShort();
    const currentYear = now.year();
    const previousYear = currentYear - 1;

    const monthlyStats = { currentYear: {}, previousYear: {} };
    allMonths.forEach((m) => {
        monthlyStats.currentYear[m] = { attended: 0, total: 0 };
        monthlyStats.previousYear[m] = { attended: 0, total: 0 };
    });

    const venueStatsMap = {};
    const ageGroups = { "4-6": { attended: 0, total: 0 }, "7-9": { attended: 0, total: 0 }, "10-12": { attended: 0, total: 0 } };
    const genderGroups = {};

    bookings.forEach((b) => {
        const month = moment(b.createdAt).format("MMM");
        const year = moment(b.createdAt).year();
        const venue = b.venue;
        const students = b.students || [];

        const targetStats = year === previousYear ? monthlyStats.previousYear : monthlyStats.currentYear;

        if (!venue) return;
        if (!venueStatsMap[venue.id]) venueStatsMap[venue.id] = { venueName: venue.name, attended: 0, total: 0 };

        students.forEach((s) => {
            const attended = s.attendance === "attended";

            targetStats[month].total += 1;
            if (attended) targetStats[month].attended += 1;

            venueStatsMap[venue.id].total += 1;
            if (attended) venueStatsMap[venue.id].attended += 1;

            if (s.age >= 4 && s.age <= 6) { ageGroups["4-6"].total++; attended && ageGroups["4-6"].attended++; }
            else if (s.age >= 7 && s.age <= 9) { ageGroups["7-9"].total++; attended && ageGroups["7-9"].attended++; }
            else if (s.age >= 10 && s.age <= 12) { ageGroups["10-12"].total++; attended && ageGroups["10-12"].attended++; }

            const gender = s.gender || "Unknown";
            if (!genderGroups[gender]) genderGroups[gender] = { attended: 0, total: 0 };
            genderGroups[gender].total += 1;
            if (attended) genderGroups[gender].attended += 1;
        });
    });

    // 🎯 Monthly attendance rates
    const monthlyAttendance = allMonths.map((month) => ({
        month,
        currentYear: {
            attended: monthlyStats.currentYear[month].attended,
            total: monthlyStats.currentYear[month].total,
            rate: monthlyStats.currentYear[month].total
                ? parseFloat(((monthlyStats.currentYear[month].attended / monthlyStats.currentYear[month].total) * 100).toFixed(2))
                : 0,
        },
        previousYear: {
            attended: monthlyStats.previousYear[month].attended,
            total: monthlyStats.previousYear[month].total,
            rate: monthlyStats.previousYear[month].total
                ? parseFloat(((monthlyStats.previousYear[month].attended / monthlyStats.previousYear[month].total) * 100).toFixed(2))
                : 0,
        },
    }));

    const currentMonth = now.format("MMM");
    const prevMonth = now.subtract(1, "month").format("MMM");

    const thisMonthObj = monthlyAttendance.find((m) => m.month === currentMonth);
    const lastMonthObj = monthlyAttendance.find((m) => m.month === prevMonth);

    const thisMonthRate = thisMonthObj ? thisMonthObj.currentYear.rate : 0;
    const lastMonthRate = lastMonthObj ? lastMonthObj.currentYear.rate : 0;

    const change = (thisMonthRate - lastMonthRate).toFixed(2);
    const formatChange = (c) => (c >= 0 ? `+${c}%` : `${c}%`);

    // Venue stats
    const venueStats = Object.values(venueStatsMap).map((v) => ({
        venueName: v.venueName,
        attended: v.attended,
        total: v.total,
        rate: v.total ? parseFloat(((v.attended / v.total) * 100).toFixed(2)) : 0,
    }));

    const topVenues = [...venueStats].sort((a, b) => b.rate - a.rate).slice(0, 5);
    const worstVenues = [...venueStats].sort((a, b) => a.rate - b.rate).slice(0, 5);

    // Age and gender rates
    const ageRate = Object.entries(ageGroups).map(([age, data]) => ({
        age,
        rate: data.total ? parseFloat(((data.attended / data.total) * 100).toFixed(2)) : 0,
    }));

    const genderRate = Object.entries(genderGroups).map(([gender, data]) => ({
        gender,
        rate: data.total ? parseFloat(((data.attended / data.total) * 100).toFixed(2)) : 0,
    }));

    // Best month
    const bestMonth = monthlyAttendance.reduce(
        (max, m) => (m.currentYear.rate > max.rate ? { month: m.month, rate: m.currentYear.rate } : max),
        { month: null, rate: 0 }
    );

    // ✅ Final response
    return {
        status: true,
        message: "Attendance analytics report generated successfully.",
        data: {
            rateOfAttendance: {
                thisMonth: thisMonthRate.toFixed(2),
                lastMonth: lastMonthRate.toFixed(2),
                change: formatChange(change),
            },
            highVenueAttendance: {
                thisMonth: topVenues[0]?.rate || 0,
                lastMonth: lastMonthRate.toFixed(2),
                change: formatChange(change),
            },
            worstVenueAttendance: {
                thisMonth: worstVenues[0]?.rate || 0,
                lastMonth: lastMonthRate.toFixed(2),
                change: formatChange(change),
            },
            attendanceGrowth: {
                thisMonth: change,
                lastMonth: lastMonthRate.toFixed(2),
                change: formatChange(change),
            },
            charts: {
                monthlyAttendance,
                bestMonth,
                topVenues,
                worstVenues,
                ageRate,
                genderRate,
            },
            allVenues: allVenues.map((v) => ({ id: v.id, name: v.name, createdBy: v.createdBy })),
            allClasses: allClasses.map((c) => ({ id: c.id, className: c.className, createdBy: c.createdBy })),
        },
    };
}

module.exports = { getBookingAttendanceAnalytics };

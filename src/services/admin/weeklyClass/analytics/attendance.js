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
        classScheduleId,
        filterByVenue,
        filterByClass,
        filterType = "thisYear", // default to thisYear
    } = filters;

    // 🗓️ Determine date range
    let startDate, endDate;
    const now = moment();

    switch (filterType) {
        case "thisMonth":
            startDate = now.clone().startOf("month").toDate();
            endDate = now.clone().endOf("month").toDate();
            break;
        case "quarter":
            startDate = now.clone().startOf("quarter").toDate();
            endDate = now.clone().endOf("quarter").toDate();
            break;
        case "lastMonth":
            startDate = now.clone().subtract(1, "month").startOf("month").toDate();
            endDate = now.clone().subtract(1, "month").endOf("month").toDate();
            break;
        case "lastYear":
            startDate = now.clone().subtract(1, "year").startOf("year").toDate();
            endDate = now.clone().subtract(1, "year").endOf("year").toDate();
            break;
        case "thisYear":
        default:
            startDate = now.clone().startOf("year").toDate();
            endDate = now.clone().endOf("year").toDate();
            break;
    }

    const whereCondition = { createdAt: { [Op.between]: [startDate, endDate] } };

    // 👑 Admin access filter
    let adminIds = [];
    if (superAdminId && superAdminId === adminId) {
        const managedAdmins = await Admin.findAll({ where: { superAdminId }, attributes: ["id"] });
        adminIds = managedAdmins.map(a => a.id);
        adminIds.push(superAdminId);
        whereCondition.bookedBy = { [Op.in]: adminIds };
    } else if (adminId && superAdminId) {
        adminIds = [adminId, superAdminId];
        whereCondition.bookedBy = { [Op.in]: adminIds };
    } else if (bookedBy) {
        whereCondition.bookedBy = bookedBy;
    }

    if (createdBy) whereCondition.createdBy = createdBy;
    if (venueId) whereCondition.venueId = venueId;
    if (classScheduleId) whereCondition.classScheduleId = classScheduleId;

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

    if (filterByVenue || venueId) {
        const venueArray = Array.isArray(filterByVenue) ? filterByVenue : [filterByVenue || venueId];
        includeConditions[1].where.id = { [Op.in]: venueArray };
    }

    if (filterByClass || classScheduleId) {
        const classArray = Array.isArray(filterByClass) ? filterByClass : [filterByClass || classScheduleId];
        includeConditions[2].where.id = { [Op.in]: classArray };
    }

    // 🧩 Fetch bookings
    const bookings = await Booking.findAll({ where: whereCondition, include: includeConditions });

    // 🔹 Initialize stats
    const allMonths = moment.monthsShort();
    const monthlyStats = {};
    const venueStatsMap = {};
    const ageGroups = { "4-6": { attended: 0, total: 0 }, "7-9": { attended: 0, total: 0 }, "10-12": { attended: 0, total: 0 } };
    const genderGroups = {};

    bookings.forEach(b => {
        const month = moment(b.createdAt).format("MMM");
        const year = moment(b.createdAt).year();
        const venue = b.venue;
        const students = b.students || [];

        if (!monthlyStats[year]) monthlyStats[year] = {};
        if (!venueStatsMap[venue?.id]) venueStatsMap[venue?.id] = { venueName: venue?.name, attended: 0, total: 0 };

        allMonths.forEach(m => { if (!monthlyStats[year][m]) monthlyStats[year][m] = { attended: 0, total: 0 }; });

        students.forEach(s => {
            const attended = s.attendance === "attended";

            // Monthly stats
            monthlyStats[year][month].total += 1;
            if (attended) monthlyStats[year][month].attended += 1;

            // Venue stats
            venueStatsMap[venue.id].total += 1;
            if (attended) venueStatsMap[venue.id].attended += 1;

            // Age groups
            if (s.age >= 4 && s.age <= 6) { ageGroups["4-6"].total++; attended && ageGroups["4-6"].attended++; }
            else if (s.age >= 7 && s.age <= 9) { ageGroups["7-9"].total++; attended && ageGroups["7-9"].attended++; }
            else if (s.age >= 10 && s.age <= 12) { ageGroups["10-12"].total++; attended && ageGroups["10-12"].attended++; }

            // Gender groups
            const gender = s.gender || "Unknown";
            if (!genderGroups[gender]) genderGroups[gender] = { attended: 0, total: 0 };
            genderGroups[gender].total += 1;
            if (attended) genderGroups[gender].attended += 1;
        });
    });

    // 🔹 Yearly totals
    const years = Object.keys(monthlyStats).map(Number).sort();
    const currentYear = years[years.length - 1];
    const previousYear = years.length > 1 ? years[years.length - 2] : null;

    const calculateYearlyRate = year => {
        if (!monthlyStats[year]) return { attended: 0, total: 0, rate: 0 };
        const total = Object.values(monthlyStats[year]).reduce((sum, m) => sum + m.total, 0);
        const attended = Object.values(monthlyStats[year]).reduce((sum, m) => sum + m.attended, 0);
        const rate = total ? parseFloat(((attended / total) * 100).toFixed(2)) : 0;
        return { attended, total, rate };
    };

    const thisYearStats = calculateYearlyRate(currentYear);
    const lastYearStats = previousYear ? calculateYearlyRate(previousYear) : { attended: 0, total: 0, rate: 0 };
    const avgChange = (thisYearStats.rate - lastYearStats.rate).toFixed(2);
    const formatChange = c => (c >= 0 ? `+${c}%` : `${c}%`);

    // 🔹 Monthly charts
    const monthlyAttendancePrev = [];
    const monthlyAttendanceCurr = [];
    allMonths.forEach(month => {
        const prev = monthlyStats[previousYear]?.[month] || { attended: 0, total: 0 };
        const curr = monthlyStats[currentYear]?.[month] || { attended: 0, total: 0 };
        monthlyAttendancePrev.push({ month, attended: prev.attended, total: prev.total, rate: prev.total ? parseFloat(((prev.attended / prev.total) * 100).toFixed(2)) : 0 });
        monthlyAttendanceCurr.push({ month, attended: curr.attended, total: curr.total, rate: curr.total ? parseFloat(((curr.attended / curr.total) * 100).toFixed(2)) : 0 });
    });

    // 🔹 Venue, age, gender percentages
    const totalAttendedAllVenues = Object.values(venueStatsMap).reduce((sum, v) => sum + v.attended, 0);
    const venueStats = Object.values(venueStatsMap).map(v => ({
        venueName: v.venueName,
        attended: v.attended,
        total: v.total,
        rate: totalAttendedAllVenues ? parseFloat(((v.attended / totalAttendedAllVenues) * 100).toFixed(2)) : 0
    }));

    const totalAttendedAllAges = Object.values(ageGroups).reduce((sum, data) => sum + data.attended, 0);
    const ageRate = Object.entries(ageGroups).map(([age, data]) => ({
        age,
        rate: totalAttendedAllAges ? parseFloat(((data.attended / totalAttendedAllAges) * 100).toFixed(2)) : 0
    }));

    const totalAttendedAllGenders = Object.values(genderGroups).reduce((sum, data) => sum + data.attended, 0);
    const genderRate = Object.entries(genderGroups).map(([gender, data]) => ({
        gender,
        rate: totalAttendedAllGenders ? parseFloat(((data.attended / totalAttendedAllGenders) * 100).toFixed(2)) : 0
    }));

    // 🔹 Top / worst venues
    const topVenues = [...venueStats].sort((a, b) => b.rate - a.rate).slice(0, 5);
    const worstVenues = [...venueStats].sort((a, b) => a.rate - b.rate).slice(0, 5);
    const usedVenueIds = [...new Set(bookings.map(b => b.venue?.id).filter(Boolean))];

    // Always define allVenues
    const allVenues = await Venue.findAll({
        attributes: ["id", "name", "createdBy"],
        order: [["name", "ASC"]],
    });
    const usedClassScheduleIds = [...new Set(bookings.map(b => b.classSchedule?.id).filter(Boolean))];
    const allClasses = await ClassSchedule.findAll({
        attributes: ["id", "className", "createdBy"],
        order: [["className", "ASC"]],
    });

    // 🔹 Best month per year
    let bestMonthPrev = { month: null, rate: 0 };
    let bestMonthCurr = { month: null, rate: 0 };
    monthlyAttendancePrev.forEach(m => { if (m.rate > bestMonthPrev.rate) bestMonthPrev = { month: m.month, rate: m.rate }; });
    monthlyAttendanceCurr.forEach(m => { if (m.rate > bestMonthCurr.rate) bestMonthCurr = { month: m.month, rate: m.rate }; });

    // ✅ Final response
    return {
        status: true,
        message: "Attendance analytics report generated successfully.",
        data: {
            rateOfAttendance: {
                thisYear: thisYearStats.rate.toFixed(2),
                lastYear: lastYearStats.rate.toFixed(2),
                change: formatChange(avgChange),
            },
            highVenueAttendance: {
                thisYear: topVenues[0]?.rate || 0,
                lastYear: lastYearStats.rate.toFixed(2),
                change: formatChange(avgChange),
            },
            worstVenueAttendance: {
                thisYear: worstVenues[0]?.rate || 0,
                lastYear: lastYearStats.rate.toFixed(2),
                change: formatChange(avgChange),
            },
            attendanceGrowth: {
                thisYear: thisYearStats.rate.toFixed(2),
                lastYear: lastYearStats.rate.toFixed(2),
                change: formatChange(avgChange),
            },
            charts: {
                monthlyAttendancePrev,
                monthlyAttendanceCurr,
                bestMonthPrev,
                bestMonthCurr,
                topVenues,
                worstVenues,
                ageRate,
                genderRate
            },
            allVenues: allVenues.map(v => ({ id: v.id, name: v.name, createdBy: v.createdBy })),
            allClasses: allClasses.map(c => ({ id: c.id, className: c.className, createdBy: c.createdBy })),
        },
    };
}

module.exports = { getBookingAttendanceAnalytics };

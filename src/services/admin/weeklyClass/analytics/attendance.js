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
        filterByVenueName,
        filterByClassName,
        filterType,
    } = filters;

    // 🗓️ Date range filter
    let startDate, endDate;
    if (filterType === "lastMonth") {
        startDate = moment().subtract(1, "month").startOf("month").toDate();
        endDate = moment().subtract(1, "month").endOf("month").toDate();
    } else if (filterType === "lastYear") {
        startDate = moment().subtract(1, "year").startOf("year").toDate();
        endDate = moment().subtract(1, "year").endOf("year").toDate();
    } else {
        // Default: this + last month combined
        startDate = moment().subtract(1, "month").startOf("month").toDate();
        endDate = moment().endOf("month").toDate();
    }

    const whereCondition = {
        createdAt: { [Op.between]: [startDate, endDate] },
    };

    // 👑 Super admin or admin access filter
    let adminIds = [];
    if (superAdminId && superAdminId === adminId) {
        const managedAdmins = await Admin.findAll({
            where: { superAdminId },
            attributes: ["id"],
        });
        adminIds = managedAdmins.map((a) => a.id);
        adminIds.push(superAdminId);
        whereCondition.bookedBy = { [Op.in]: adminIds };
    } else if (adminId && superAdminId) {
        adminIds = [adminId, superAdminId];
        whereCondition.bookedBy = { [Op.in]: adminIds };
    } else if (bookedBy) {
        whereCondition.bookedBy = bookedBy;
    }

    // 🎯 Additional filters
    if (createdBy) whereCondition.createdBy = createdBy;
    if (venueId) whereCondition.venueId = venueId;

    // 🏟️ Include relationships
    const includeConditions = [
        {
            model: BookingStudentMeta,
            as: "students",
            attributes: ["attendance", "age", "gender"],
        },
        {
            model: Venue,
            as: "venue",
            attributes: ["id", "name", "createdBy"],
            where: {},
        },
        {
            model: ClassSchedule,
            as: "classSchedule",
            attributes: ["id", "className", "createdBy"],
            where: {},
        },
    ];

    // 📍 Filter by venue name
    if (filterByVenueName) {
        includeConditions[1].where.name = { [Op.like]: `%${filterByVenueName}%` };
    }

    // 📘 Filter by class name (from ClassSchedule, not Booking)
    if (filterByClassName) {
        includeConditions[2].where.className = { [Op.like]: `%${filterByClassName}%` };
    }

    // 🧩 Get bookings + students + venues + classes
    const bookings = await Booking.findAll({
        where: whereCondition,
        include: includeConditions,
    });

    // 🔹 Get all venues used
    const usedVenueIds = [
        ...new Set(bookings.map((b) => b.venue?.id).filter(Boolean)),
    ];

    const allVenues = await Venue.findAll({
        where: { id: usedVenueIds },
        attributes: ["id", "name", "createdBy"],
        order: [["name", "ASC"]],
    });

    // 🔹 Get all class schedules used
    const usedClassScheduleIds = [
        ...new Set(bookings.map((b) => b.classSchedule?.id).filter(Boolean)),
    ];

    const allClasses = await ClassSchedule.findAll({
        where: { id: usedClassScheduleIds },
        attributes: ["id", "className", "createdBy"],
        order: [["className", "ASC"]],
    });

    // 🔹 Monthly stats
    const monthlyStats = {};
    const allMonths = moment.monthsShort();
    allMonths.forEach((m) => (monthlyStats[m] = { attended: 0, total: 0 }));

    // 🔹 Venue stats, Age groups & Gender groups
    const venueStatsMap = {};
    const ageGroups = {
        "4-6": { attended: 0, total: 0 },
        "7-9": { attended: 0, total: 0 },
        "10-12": { attended: 0, total: 0 },
    };
    const genderGroups = {};

    bookings.forEach((b) => {
        const month = moment(b.createdAt).format("MMM");
        const venue = b.venue;
        const students = b.students || [];

        if (!venue) return;

        if (!venueStatsMap[venue.id])
            venueStatsMap[venue.id] = { venueName: venue.name, attended: 0, total: 0 };

        students.forEach((s) => {
            const attended = s.attendance === "attended";
            if (attended) {
                venueStatsMap[venue.id].attended += 1;
                monthlyStats[month].attended += 1;
            }
            venueStatsMap[venue.id].total += 1;
            monthlyStats[month].total += 1;

            // 🧒 Age grouping
            if (s.age >= 4 && s.age <= 6)
                ageGroups["4-6"].total++, attended && ageGroups["4-6"].attended++;
            else if (s.age >= 7 && s.age <= 9)
                ageGroups["7-9"].total++, attended && ageGroups["7-9"].attended++;
            else if (s.age >= 10 && s.age <= 12)
                ageGroups["10-12"].total++, attended && ageGroups["10-12"].attended++;

            // 🚻 Gender grouping
            const gender = s.gender || "Unknown";
            if (!genderGroups[gender]) genderGroups[gender] = { attended: 0, total: 0 };
            genderGroups[gender].total += 1;
            if (attended) genderGroups[gender].attended += 1;
        });
    });

    // 🎯 Monthly attendance rates
    const monthlyAttendance = allMonths.map((month) => {
        const { attended, total } = monthlyStats[month];
        const rate = total ? (attended / total) * 100 : 0;
        return { month, attended, total, rate: parseFloat(rate.toFixed(2)) };
    });

    // 🧮 This + last month rates
    const currentMonth = moment().format("MMM");
    const prevMonth = moment().subtract(1, "month").format("MMM");

    const thisMonthObj = monthlyAttendance.find((m) => m.month === currentMonth);
    const lastMonthObj = monthlyAttendance.find((m) => m.month === prevMonth);

    const thisMonthRate = thisMonthObj ? thisMonthObj.rate : 0;
    const lastMonthRate = lastMonthObj ? lastMonthObj.rate : 0;

    const change = (thisMonthRate - lastMonthRate).toFixed(2);
    const formatChange = (c) => (c >= 0 ? `+${c}%` : `${c}%`);

    // 🏟️ Venue rates
    const venueStats = Object.values(venueStatsMap).map((v) => ({
        venueName: v.venueName,
        attended: v.attended,
        total: v.total,
        rate: v.total ? parseFloat(((v.attended / v.total) * 100).toFixed(2)) : 0,
    }));

    const topVenues = [...venueStats].sort((a, b) => b.rate - a.rate).slice(0, 5);
    const worstVenues = [...venueStats].sort((a, b) => a.rate - b.rate).slice(0, 5);

    // 🧒 Age rates
    const ageRate = Object.entries(ageGroups).map(([age, data]) => ({
        age,
        rate: data.total ? parseFloat(((data.attended / data.total) * 100).toFixed(2)) : 0,
    }));

    // 🚻 Gender rates
    const genderRate = Object.entries(genderGroups).map(([gender, data]) => ({
        gender,
        rate: data.total ? parseFloat(((data.attended / data.total) * 100).toFixed(2)) : 0,
    }));

    // 🌟 Best month
    const bestMonth = monthlyAttendance.reduce(
        (max, m) => (m.rate > max.rate ? m : max),
        { month: null, rate: 0 }
    );

    // ✅ Final Response
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
            allVenues: allVenues.map((v) => ({
                id: v.id,
                name: v.name,
                createdBy: v.createdBy,
            })),
            allClasses: allClasses.map((c) => ({
                id: c.id,
                className: c.className,
                createdBy: c.createdBy,
            })),
        },
    };
}

module.exports = { getBookingAttendanceAnalytics };

const { Op } = require("sequelize");
const moment = require("moment");
const { Booking, ClassSchedule, PaymentPlan, Admin } = require("../../../../models");

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

// 🔹 Helper: total class capacity
async function getTotalCapacity(adminIds) {
    const classSchedules = await ClassSchedule.findAll({
        where: { createdBy: { [Op.in]: adminIds } },
        attributes: ["capacity"],
    });

    return classSchedules.reduce((sum, c) => sum + (c.capacity || 0), 0);
}

// 🔹 Helper: total occupied spaces (confirmed/active)
async function getOccupiedSpaces(periodStart, periodEnd, adminIds) {
    const where = {
        status: { [Op.in]: ["active", "not_attended", "attended", "pending"] },
        bookedBy: { [Op.in]: adminIds },
    };

    if (periodStart && periodEnd) {
        where.createdAt = { [Op.between]: [periodStart, periodEnd] };
    }

    return Booking.count({ where });
}

// 🔹 Helper: total revenue (from PaymentPlan)
async function getTotalRevenue(periodStart, periodEnd, adminIds) {
    const where = {
        status: { [Op.in]: ["active"] },
        bookedBy: { [Op.in]: adminIds },
    };

    if (periodStart && periodEnd) {
        where.createdAt = { [Op.between]: [periodStart, periodEnd] };
    }

    const bookings = await Booking.findAll({
        where,
        include: [
            {
                model: PaymentPlan,
                as: "paymentPlan", // ✅ use alias if defined
                attributes: ["price"],
                required: true,
            },
        ],
    });

    const totalRevenue = bookings.reduce(
        (sum, b) => sum + (b.paymentPlan?.price || 0),
        0
    );

    return totalRevenue;
}

// 🔹 Helper: month-wise capacity trend (current vs previous year)
async function getCapacityMonthWise(superAdminId,filters, adminId) {
    const adminIds = await getAdminFilter(superAdminId, adminId);
    const now = moment();
    const currentYear = now.year();
    const prevYear = currentYear - 1;

    const monthlyData = [];

    // ✅ Loop through all 12 months (Jan → Dec)
    for (let month = 0; month < 12; month++) {
        const startCurrent = moment().year(currentYear).month(month).startOf("month").toDate();
        const endCurrent = moment().year(currentYear).month(month).endOf("month").toDate();
        const startPrev = moment().year(prevYear).month(month).startOf("month").toDate();
        const endPrev = moment().year(prevYear).month(month).endOf("month").toDate();

        // ✅ Get total class capacity for this month (current year)
        const currentSchedules = await ClassSchedule.findAll({
            where: {
                createdBy: { [Op.in]: adminIds },
                createdAt: { [Op.between]: [startCurrent, endCurrent] },
            },
            attributes: ["capacity"],
        });
        const currentYearCount = currentSchedules.reduce(
            (sum, c) => sum + (c.capacity || 0),
            0
        );

        // ✅ Get total class capacity for this month (previous year)
        const prevSchedules = await ClassSchedule.findAll({
            where: {
                createdBy: { [Op.in]: adminIds },
                createdAt: { [Op.between]: [startPrev, endPrev] },
            },
            attributes: ["capacity"],
        });
        const prevYearCount = prevSchedules.reduce(
            (sum, c) => sum + (c.capacity || 0),
            0
        );

        // ✅ Calculate overall capacity (sum of both years for reference)
        const totalCapacity = currentYearCount + prevYearCount;

        // ✅ Occupancy Rate (not based on booking, just relative change)
        const occupancyRate =
            totalCapacity > 0
                ? `${((currentYearCount / totalCapacity) * 100).toFixed(2)}%`
                : "0%";

        monthlyData.push({
            month: moment().month(month).format("MMM"), // Jan, Feb, ...
            currentYearCount,
            prevYearCount,
            totalCapacity,
            occupancyRate,
        });
    }

    return { monthWise: monthlyData };
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
    const totalCapacity = await getTotalCapacity(adminIds);
    const occupiedCurrent = await getOccupiedSpaces(currentStart, currentEnd, adminIds);
    const revenueCurrent = await getTotalRevenue(currentStart, currentEnd, adminIds);

    // --- Previous period ---
    const occupiedPrev = await getOccupiedSpaces(prevStart, prevEnd, adminIds);
    const revenuePrev = await getTotalRevenue(prevStart, prevEnd, adminIds);

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
            vsPrev: totalCapacity * 0.9,
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
    getCapacityWidgets, getCapacityMonthWise
};

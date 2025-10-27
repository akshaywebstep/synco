const { Op } = require("sequelize");
const {
  BookingStudentMeta,
  Booking,
  ClassSchedule,
  AdminDashboardWidget,
} = require("../../models");
const moment = require("moment");

// 🧩 Widget Key Constants
const DASHBOARD_WIDGET_KEYS = [
  "totalStudents",
  "trialsBooked",
  "cancellations",
  "revenue",
  "classCapacity",
  "growth",
  "customerSatisfaction",
  "mechandiesSales",
];

moment.updateLocale("en", { week: { dow: 0 } }); // Week starts Sunday

// Helper function for percent change
const getPercentChange = (part, total) => {
  if (!total) return 0; // avoid divide by zero
  return ((part - total) / total) * 100;
};

exports.getDashboardStats = async (
  adminId,
  filterType = null,
  fromDate = null,
  toDate = null
) => {
  try {

    if (!adminId || isNaN(Number(adminId))) {
      return {
        status: false,
        message: "No valid parent or super admin found for this request.",
        data: [],
      };
    }
    // --- Handle filterType logic only if no manual dates are provided
    if (filterType && !fromDate && !toDate) {
      const now = new Date();
      let start, end;

      if (filterType === "thismonth") {
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
      } else if (filterType === "lastmonth") {
        start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
      } else if (filterType === "thisweek") {
        const firstDay = now.getDate() - now.getDay(); // Sunday start
        start = new Date(now);
        start.setDate(firstDay);
        start.setHours(0, 0, 0, 0);
        end = new Date(start);
        end.setDate(start.getDate() + 6);
        end.setHours(23, 59, 59, 999);
      } else if (filterType === "lastweek") {
        const firstDay = now.getDate() - now.getDay() - 7; // previous Sunday
        start = new Date(now);
        start.setDate(firstDay);
        start.setHours(0, 0, 0, 0);
        end = new Date(start);
        end.setDate(start.getDate() + 6);
        end.setHours(23, 59, 59, 999);
      } else if (filterType === "thisyear") {
        start = new Date(now.getFullYear(), 0, 1);
        end = new Date(now.getFullYear(), 11, 31, 23, 59, 59);
      } else if (filterType === "lastyear") {
        start = new Date(now.getFullYear() - 1, 0, 1);
        end = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59);
      }

      fromDate = start;
      toDate = end;
    }

    // --- Admin schedules (all-time or filtered)
    const scheduleWhere = { createdBy: adminId };

    if (fromDate && toDate) {
      scheduleWhere.createdAt = {
        [Op.between]: [new Date(fromDate), new Date(toDate)],
      };
    }

    const adminSchedules = await ClassSchedule.findAll({
      where: scheduleWhere,
      attributes: ["id", "capacity", "createdAt"],
    });
    const adminClassScheduleIds = adminSchedules.map((cls) => cls.id);

    // Total and average class capacity
    const totalCapacity = adminSchedules.reduce(
      (sum, cls) => sum + (cls.capacity || 0),
      0
    );
    const avgCapacity = adminSchedules.length
      ? totalCapacity / adminSchedules.length
      : 0;

    // --- Admin bookings (all-time or filtered)
    const bookingWhere = {
      classScheduleId: { [Op.in]: adminClassScheduleIds },
    };

    if (fromDate && toDate) {
      bookingWhere.createdAt = {
        [Op.between]: [new Date(fromDate), new Date(toDate)],
      };
    }

    const adminBookings = await Booking.findAll({
      where: bookingWhere,
      attributes: ["id", "createdAt"],
    });
    const adminBookingIds = adminBookings.map((b) => b.id);

    // --- Total students
    const totalStudents = await BookingStudentMeta.count({
      where: { bookingTrialId: { [Op.in]: adminBookingIds } },
    });

    // --- Trials (all-time or filtered)
    const trialsBookedCount = await Booking.count({
      where: {
        ...bookingWhere,
        bookingType: "free",
        status: "pending",
      },
    });

    // --- Cancellations (all-time or filtered)
    const cancellationsCount = await Booking.count({
      where: {
        ...bookingWhere,
        status: "cancelled",
      },
    });

    // Fetch widgets
    const widgets = await AdminDashboardWidget.findAll({
      where: { adminId: Number(adminId)},
      //  where: { createdBy: Number(createdBy) },
      order: [["order", "ASC"]],
    });

    // Prepare full dashboard data
    const fullDashboardData = {
      totalStudents: {
        count: totalStudents,
        thisWeek: { conversion: `${totalStudents}%` },
        lastMonth: { conversion: `${totalStudents}%` },
      },
      trialsBooked: {
        count: trialsBookedCount,
        thisWeek: { conversion: `${trialsBookedCount}%` },
        lastMonth: { conversion: `${trialsBookedCount}%` },
      },
      classCapacity: {
        count: totalCapacity,
        thisWeek: { conversion: `${avgCapacity.toFixed(2)}%` },
        lastMonth: { conversion: `${avgCapacity.toFixed(2)}%` },
      },
      cancellations: {
        count: cancellationsCount,
        thisWeek: { conversion: `${cancellationsCount}%` },
        lastMonth: { conversion: `${cancellationsCount}%` },
      },
    };

    // Build dashboard data
    let dashboardData = {};

    // If widgets exist, add them in their order
    if (widgets.length > 0) {
      widgets.forEach(widget => {
        const key = widget.key;
        if (fullDashboardData[key]) {
          dashboardData[key] = fullDashboardData[key];
        }
      });
      // Add any missing blocks that were not in widgets
      Object.keys(fullDashboardData).forEach(key => {
        if (!dashboardData[key]) {
          dashboardData[key] = fullDashboardData[key];
        }
      });
    } else {
      // No widgets → return all blocks in default order
      dashboardData = fullDashboardData;
    }

    // Return final response
    return {
      status: true,
      message: "Dashboard stats fetched successfully.",
      data: dashboardData,
    };
  } catch (error) {
    console.error("❌ Error in getDashboardStats:", error);
    return {
      status: false,
      message: error?.message || "Failed to fetch dashboard stats.",
    };
  }
};

// 🔍 Get all dashboard widgets filtered by adminId
exports.getWidgetsByAdmin = async (adminId) => {
  try {
    const widgets = await AdminDashboardWidget.findAll({
      where: { adminId }, // only fetch widgets for this admin
      order: [["order", "ASC"]],
    });

    return {
      status: true,
      data: widgets,
    };
  } catch (error) {
    console.error("❌ getWidgetsByAdmin Error:", error);
    return {
      status: false,
      message: error.message,
    };
  }
};

// 🔄 Update or insert widgets (with adminId)
exports.updateWidgetsOrderAndVisibility = async (adminId, widgets = []) => {
  try {
    for (const { key, order, visible } of widgets) {
      if (!DASHBOARD_WIDGET_KEYS.includes(key)) {
        throw new Error(`Invalid widget key: ${key}`);
      }

      const [widget, created] = await AdminDashboardWidget.findOrCreate({
        where: { key, adminId },
        defaults: { order, visible, adminId },
      });

      if (!created) {
        await widget.update({ order, visible });
      }
    }

    const updatedWidgets = await AdminDashboardWidget.findAll({
      where: { adminId },
      order: [["order", "ASC"]],
      attributes: ["key", "order", "visible"],
    });

    return {
      status: true,
      message: "Widgets updated successfully.",
      data: updatedWidgets,
    };
  } catch (error) {
    console.error("❌ updateWidgetsOrderAndVisibility Error:", error);
    return {
      status: false,
      message: error?.message || "Failed to update widgets.",
    };
  }
};

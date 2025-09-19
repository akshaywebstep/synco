const { ActivityLog } = require("../../models");

// Create Activity Log with validation for all required fields
exports.create = async (logData = {}) => {
  try {
    const requiredFields = ["adminId", "method", "route", "ip", "userAgent"];
    const missingFields = [];

    for (const field of requiredFields) {
      if (
        !logData.hasOwnProperty(field) ||
        logData[field] === null ||
        logData[field] === undefined ||
        (typeof logData[field] === "string" && logData[field].trim() === "")
      ) {
        missingFields.push(field);
      }
    }

    if (missingFields.length > 0) {
      return {
        status: false,
        message: `Missing or empty required fields: ${missingFields.join(", ")}`,
      };
    }

    const activityLog = await ActivityLog.create({
      adminId: logData.adminId,
      panel: logData.panel,
      module: logData.module,
      action: logData.action,
      data: logData.data,
      status: logData.status,
      method: logData.method,
      route: logData.route,
      ip: logData.ip,
      userAgent: logData.userAgent,
      location: logData.location || null,
      ispInfo: logData.ispInfo || null,
      deviceInfo: logData.deviceInfo || null,
    });

    return {
      status: true,
      message: "ActivityLog created successfully.",
      data: { id: activityLog.id },
    };
  } catch (error) {
    console.error("❌ Sequelize Error in createActivityLog:", error);

    return {
      status: false,
      message:
        error?.parent?.sqlMessage || error?.message || "Failed to create activity log.",
    };
  }
};

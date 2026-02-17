const {
  Course,
  Admin,
} = require("../../../models");
const DEBUG = process.env.DEBUG === "true";
const mm = require('music-metadata');
const path = require('path');
const { Op } = require("sequelize");
const { deleteFromFTP } = require("../../../utils/uploadToFTP");
const fs = require("fs");

// Create course
exports.createCourse = async (data) => {
  try {
    const course = await Course.create(data);

    return {
      status: true,
      message: "Course created successfully.",
      data: course,
    };
  } catch (error) {
    console.error("❌ Sequelize Error in createCourse:", error);

    return {
      status: false,
      message:
        error?.parent?.sqlMessage ||
        error?.message ||
        "Failed to createCourse.",
    };
  }
};

const parseJSONSafe = (value, fallback = []) => {
  try {
    if (value === null || value === undefined) return fallback;

    if (typeof value === "string") {
      let parsed = value;

      // Handle double-encoded JSON
      while (typeof parsed === "string") {
        parsed = JSON.parse(parsed);
      }

      return parsed;
    }

    return value;
  } catch {
    return fallback;
  }
};

exports.getCourses = async (adminId, superAdminId) => {
  try {
    // -----------------------------
    // 1️⃣ Validate adminId
    // -----------------------------
    if (!adminId || isNaN(Number(adminId))) {
      return {
        status: false,
        message: "No valid admin ID found for this request.",
        data: [],
      };
    }

    // -----------------------------
    // 2️⃣ Build WHERE condition
    // -----------------------------
    const whereCondition = {};
    let allowedAdminIds = [];

    if (superAdminId && superAdminId === adminId) {
      // 🟢 Super Admin → fetch all admins under them + self
      const managedAdmins = await Admin.findAll({
        where: { superAdminId },
        attributes: ["id"],
      });

      const adminIds = managedAdmins.map((a) => a.id);
      adminIds.push(superAdminId);

      allowedAdminIds = adminIds;
      whereCondition.createdBy = { [Op.in]: adminIds };

    } else if (superAdminId && adminId) {
      // 🟢 Admin → own + super admin contracts
      allowedAdminIds = [adminId, superAdminId];
      whereCondition.createdBy = { [Op.in]: allowedAdminIds };

    } else {
      // 🟢 Fallback → only own contracts
      allowedAdminIds = [adminId];
      whereCondition.createdBy = adminId;
    }

    const rows = await Course.findAll({
      where: whereCondition,
      order: [["createdAt", "DESC"]],
    });

    const parsedRows = rows.map((course) => {
      const data = course.toJSON();
      return {
        ...data,
        modules: parseJSONSafe(data.modules, []),
        questions: parseJSONSafe(data.questions, []),
        notifiedUsers: parseJSONSafe(data.notifiedUsers, []),
        duration: Number(data.duration),
        reTakeCourse: Number(data.reTakeCourse),
        passingConditionValue: Number(data.passingConditionValue),
        setReminderEvery: Number(data.setReminderEvery),
        isCompulsory: Boolean(data.isCompulsory),
      };
    });

    return { status: true, message: "Course list fetched successfully.", data: parsedRows };
  } catch (error) {
    console.error("❌ Sequelize Error in listCourses:", error);
    return { status: false, message: error?.parent?.sqlMessage || error?.message || "Failed to fetch courses." };
  }
};

exports.getCourseById = async (courseId, adminId, superAdminId) => {
  try {
    // 1️⃣ Validate adminId
    // -----------------------------
    if (!adminId || isNaN(Number(adminId))) {
      return {
        status: false,
        message: "No valid admin ID found for this request.",
        data: [],
      };
    }

    // -----------------------------
    // 2️⃣ Build WHERE condition
    // -----------------------------
    const whereCondition = {};
    let allowedAdminIds = [];

    if (superAdminId && superAdminId === adminId) {
      // 🟢 Super Admin → fetch all admins under them + self
      const managedAdmins = await Admin.findAll({
        where: { superAdminId },
        attributes: ["id"],
      });

      const adminIds = managedAdmins.map((a) => a.id);
      adminIds.push(superAdminId);

      allowedAdminIds = adminIds;
      whereCondition.createdBy = { [Op.in]: adminIds };

    } else if (superAdminId && adminId) {
      // 🟢 Admin → own + super admin contracts
      allowedAdminIds = [adminId, superAdminId];
      whereCondition.createdBy = { [Op.in]: allowedAdminIds };

    } else {
      // 🟢 Fallback → only own contracts
      allowedAdminIds = [adminId];
      whereCondition.createdBy = adminId;
    }
    if (!courseId) {
      return { status: false, message: "Course ID is required." };
    }

    const course = await Course.findOne({
      where: {
        id: courseId,
        ...whereCondition,
      },
    });
    if (!course) {
      return { status: false, message: "Course not found." };
    }

    const data = course.toJSON();

    const parsedCourse = {
      ...data,
      modules: parseJSONSafe(data.modules, []),
      questions: parseJSONSafe(data.questions, []),
      notifiedUsers: parseJSONSafe(data.notifiedUsers, []),
      reTakeCourse: Number(data.reTakeCourse),
      passingConditionValue: Number(data.passingConditionValue),
      isCompulsory: Boolean(data.isCompulsory),
    };

    return {
      status: true,
      message: "Course fetched successfully.",
      data: parsedCourse,
    };
  } catch (error) {
    console.error("❌ Sequelize Error in getCourseById:", error);

    return {
      status: false,
      message:
        error?.parent?.sqlMessage ||
        error?.message ||
        "Failed to fetch course.",
    };
  }
};

exports.updateCourse = async (courseId, data) => {
  try {
    if (!courseId) {
      return {
        status: false,
        message: "Course ID is required.",
      };
    }

    const course = await Course.findOne({
      where: { id: courseId },
    });

    if (!course) {
      return {
        status: false,
        message: "Course not found.",
      };
    }

    await course.update(data);

    return {
      status: true,
      message: "Course updated successfully.",
      data: course,
    };
  } catch (error) {
    console.error("❌ Sequelize Error in updateCourse:", error);

    return {
      status: false,
      message:
        error?.parent?.sqlMessage ||
        error?.message ||
        "Failed to update course.",
    };
  }
};
const getFTPPathFromUrl = (url) => {
  if (!url) return null;
  try {
    return new URL(url).pathname; // ✅ "/modules/335/filename.png"
  } catch {
    return null;
  }
};
exports.deleteCourse = async (courseId, deletedBy) => {
  try {
    if (DEBUG) console.log("🗑️ Delete course started:", courseId);

    if (!courseId) {
      return { status: false, message: "Course ID is required." };
    }

    const course = await Course.findOne({
      where: { id: courseId, deletedAt: null },
    });

    if (!course) {
      return {
        status: false,
        message: "Course not found or already deleted.",
      };
    }

    const data = course.toJSON();
    const deleteTasks = [];

    /* ---------- CERTIFICATE ---------- */
    if (data.uploadCertificate) {
      const certPath = getFTPPathFromUrl(data.uploadCertificate);
      if (certPath) {
        if (DEBUG) console.log("🧹 Deleting certificate:", certPath);
        deleteTasks.push(deleteFromFTP(certPath));
      }
    }

    /* ---------- MODULE FILES ---------- */
    let modules = data.modules;

    if (typeof modules === "string") {
      try {
        modules = JSON.parse(modules);
      } catch {
        modules = [];
      }
    }

    if (Array.isArray(modules)) {
      for (const module of modules) {
        if (Array.isArray(module.uploadFiles)) {
          for (const file of module.uploadFiles) {
            if (file?.url) {
              const filePath = getFTPPathFromUrl(file.url);
              if (filePath) {
                if (DEBUG) console.log("🧹 Deleting module file:", filePath);
                deleteTasks.push(deleteFromFTP(filePath));
              }
            }
          }
        }
      }
    }

    await Promise.allSettled(deleteTasks);
    if (DEBUG) console.log("✅ FTP cleanup completed");

    /* ---------- SOFT DELETE ---------- */
    // save who deleted
    await course.update({ deletedBy });

    // soft delete (sets deletedAt)
    await course.destroy();

    if (DEBUG) console.log("✅ Course soft deleted");

    return {
      status: true,
      message: "Course deleted successfully.",
      data: course,
    };
  } catch (error) {
    console.error("❌ Error in deleteCourse:", error);
    return {
      status: false,
      message:
        error?.parent?.sqlMessage ||
        error?.message ||
        "Failed to delete course.",
    };
  }
};

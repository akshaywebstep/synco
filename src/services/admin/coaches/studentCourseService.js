const {
    Admin,
    StudentCourse,
} = require("../../../models");
const DEBUG = process.env.DEBUG === "true";
const path = require('path');
const { getVideoDurationInSeconds, formatDuration } = require("../../../utils/videoHelper"); // adjust path
const { Op } = require("sequelize");
const { renameOnFTP, deleteFromFTP } = require("../../../utils/uploadToFTP");
const fs = require("fs");

/**
 * Create Student Course
 */
exports.createStudentCourse = async (data) => {
    try {
        const studentCourse = await StudentCourse.create({
            courseName: data.courseName,
            duration: data.duration,
            durationType: data.durationType,
            level: data.level,
            coverImage: data.coverImage,

            // ✅ NEW: multiple videos JSON
            videos: data.videos,

            createdBy: data.createdBy,
        });

        return {
            status: true,
            message: "Student Course created successfully.",
            data: studentCourse,
        };
    } catch (error) {
        console.error("❌ Sequelize Error in createStudentCourse:", error);

        return {
            status: false,
            message:
                error?.parent?.sqlMessage ||
                error?.message ||
                "Failed to create StudentCourse.",
        };
    }
};

/**
 * Get All Student Course
 */
exports.getAllStudentCourses = async (adminId, superAdminId) => {
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

        // -----------------------------
        // 3️⃣ Fetch contracts
        // -----------------------------
        const studentCourse = await StudentCourse.findAll({
            where: whereCondition,
            order: [["createdAt", "DESC"]],
        });

        return {
            status: true,
            message: "Student Course fetched successfully.",
            data: studentCourse,
        };
    } catch (error) {
        console.error("❌ Sequelize Error in getAllStudentCourses:", error);

        return {
            status: false,
            message:
                error?.parent?.sqlMessage ||
                error?.message ||
                "Failed to fetch student courses.",
            data: [],
        };
    }
};

/**
 * Get Single Student Course
 */
exports.getStudentCourseById = async (adminId, superAdminId, courseId) => {
    try {
        // -----------------------------
        // 1️⃣ Validate inputs
        // -----------------------------
        if (!adminId || isNaN(Number(adminId))) {
            return {
                status: false,
                message: "No valid admin ID found.",
                data: null,
            };
        }

        if (!courseId || isNaN(Number(courseId))) {
            return {
                status: false,
                message: "Invalid student course ID.",
                data: null,
            };
        }

        // -----------------------------
        // 2️⃣ Resolve allowed admin IDs
        // -----------------------------
        let allowedAdminIds = [];

        if (superAdminId && superAdminId === adminId) {
            // 🟢 Super Admin → all managed admins + self
            const managedAdmins = await Admin.findAll({
                where: { superAdminId },
                attributes: ["id"],
            });

            allowedAdminIds = managedAdmins.map((a) => a.id);
            allowedAdminIds.push(superAdminId);

        } else if (superAdminId) {
            // 🟢 Admin → own + super admin
            allowedAdminIds = [adminId, superAdminId];

        } else {
            // 🟢 Fallback → own only
            allowedAdminIds = [adminId];
        }

        // -----------------------------
        // 3️⃣ Fetch single course
        // -----------------------------
        const studentCourse = await StudentCourse.findOne({
            where: {
                id: courseId,
                createdBy: { [Op.in]: allowedAdminIds },
            },
        });

        if (!studentCourse) {
            return {
                status: false,
                message: "Student course not found or access denied.",
                data: null,
            };
        }

        return {
            status: true,
            message: "Student course fetched successfully.",
            data: studentCourse,
        };

    } catch (error) {
        console.error("❌ Sequelize Error in getStudentCourseById:", error);

        return {
            status: false,
            message:
                error?.parent?.sqlMessage ||
                error?.message ||
                "Failed to fetch student course.",
            data: null,
        };
    }
};

/**
 * Update Student Course by ID
 */
exports.updateStudentCourseById = async (adminId, superAdminId, courseId, updateData) => {
    try {
        // -----------------------------
        // 1️⃣ Validate inputs
        // -----------------------------
        if (!adminId || isNaN(Number(adminId))) {
            return {
                status: false,
                message: "No valid admin ID found.",
                data: null,
            };
        }

        if (!courseId || isNaN(Number(courseId))) {
            return {
                status: false,
                message: "Invalid student course ID.",
                data: null,
            };
        }

        // -----------------------------
        // 2️⃣ Resolve allowed admin IDs
        // -----------------------------
        let allowedAdminIds = [];

        if (superAdminId && superAdminId === adminId) {
            // Super Admin → all managed admins + self
            const managedAdmins = await Admin.findAll({
                where: { superAdminId },
                attributes: ["id"],
            });

            allowedAdminIds = managedAdmins.map((a) => a.id);
            allowedAdminIds.push(superAdminId);

        } else if (superAdminId) {
            // Admin → own + super admin
            allowedAdminIds = [adminId, superAdminId];

        } else {
            // Fallback → own only
            allowedAdminIds = [adminId];
        }

        // -----------------------------
        // 3️⃣ Find the course first
        // -----------------------------
        const studentCourse = await StudentCourse.findOne({
            where: {
                id: courseId,
                createdBy: { [Op.in]: allowedAdminIds },
            },
        });

        if (!studentCourse) {
            return {
                status: false,
                message: "Student course not found or access denied.",
                data: null,
            };
        }

        // -----------------------------
        // 4️⃣ Update the course
        // -----------------------------
        await studentCourse.update(updateData);

        return {
            status: true,
            message: "Student course updated successfully.",
            data: studentCourse,
        };

    } catch (error) {
        console.error("❌ Sequelize Error in updateStudentCourseById:", error);

        return {
            status: false,
            message:
                error?.parent?.sqlMessage ||
                error?.message ||
                "Failed to update student course.",
            data: null,
        };
    }
};

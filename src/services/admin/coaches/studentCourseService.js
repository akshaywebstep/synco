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
 * Update Student Course (Controller)
 */
exports.updateStudentCourse = async (req, res) => {
    try {
        const adminId = req.admin.id;
        const superAdminId = req.admin.superAdminId || null;
        const courseId = req.params.id;

        const body = req.body;
        const files = req.files || {};

        // -----------------------------
        // 1️⃣ Parse videos JSON safely
        // -----------------------------
        let videos = [];

        if (body.videos) {
            videos =
                typeof body.videos === "string"
                    ? JSON.parse(body.videos)
                    : body.videos;
        }

        // -----------------------------
        // 2️⃣ Replace video URLs if binary uploaded
        // -----------------------------
        videos = videos.map((video, index) => {
            const fileKey = `video_${index}`;

            if (files[fileKey]?.[0]) {
                return {
                    ...video,
                    video: files[fileKey][0].path, // OR .location for S3
                };
            }

            return video; // keep existing URL
        });

        // -----------------------------
        // 3️⃣ Build update payload
        // -----------------------------
        const updateData = {
            courseName: body.courseName,
            level: body.level,
            duration: body.duration,
            durationType: body.durationType,
            videos,
        };

        // -----------------------------
        // 4️⃣ Call service
        // -----------------------------
        const result = await updateStudentCourseById(
            adminId,
            superAdminId,
            courseId,
            updateData
        );

        return res.status(result.status ? 200 : 400).json(result);

    } catch (error) {
        console.error("❌ updateStudentCourse Error:", error);
        return res.status(500).json({
            status: false,
            message: error.message,
            data: null,
        });
    }
};

/**
 * Soft Delete Student Course by ID (save deletedBy & deletedAt + delete FTP files)
 */
exports.deleteStudentCourseById = async (adminId, superAdminId, courseId) => {
    try {
        // -----------------------------
        // 1️⃣ Validate inputs
        // -----------------------------
        if (!adminId || isNaN(Number(adminId))) {
            return {
                status: false,
                message: "No valid admin ID found.",
            };
        }

        if (!courseId || isNaN(Number(courseId))) {
            return {
                status: false,
                message: "Invalid student course ID.",
            };
        }

        // -----------------------------
        // 2️⃣ Resolve allowed admin IDs
        // -----------------------------
        let allowedAdminIds = [];

        if (superAdminId && superAdminId === adminId) {
            const managedAdmins = await Admin.findAll({
                where: { superAdminId },
                attributes: ["id"],
            });

            allowedAdminIds = managedAdmins.map(a => a.id);
            allowedAdminIds.push(superAdminId);

        } else if (superAdminId) {
            allowedAdminIds = [adminId, superAdminId];
        } else {
            allowedAdminIds = [adminId];
        }

        // -----------------------------
        // 3️⃣ Find course (NOT deleted)
        // -----------------------------
        const studentCourse = await StudentCourse.findOne({
            where: {
                id: courseId,
                createdBy: { [Op.in]: allowedAdminIds },
                deletedAt: null, // ⛔ already deleted protection
            },
        });

        if (!studentCourse) {
            return {
                status: false,
                message: "Student course not found or already deleted.",
            };
        }

        // -----------------------------
        // 4️⃣ Delete files from FTP
        // -----------------------------
        if (studentCourse.coverImage) {
            await deleteFromFTP(studentCourse.coverImage);
        }

        if (Array.isArray(studentCourse.videos)) {
            for (const video of studentCourse.videos) {
                if (video?.video) {
                    await deleteFromFTP(video.video);
                }

            }
        }

        await studentCourse.destroy(); // ✅ sets deletedAt automatically

        await StudentCourse.update(
            { deletedBy: adminId },
            {
                where: { id: courseId },
                paranoid: false, // ✅ allow update after soft delete
            }
        );

        return {
            status: true,
            message: "Student course deleted successfully.",
        };

    } catch (error) {
        console.error("❌ Sequelize Error in deleteStudentCourseById:", error);

        return {
            status: false,
            message:
                error?.parent?.sqlMessage ||
                error?.message ||
                "Failed to delete student course.",
        };
    }
};

/**
 * Reorder Student Course
 */

exports.reorderStudentCourse = async (orderedIds = [], createdBy) => {
    try {
        for (let index = 0; index < orderedIds.length; index++) {
            const id = orderedIds[index];
            await StudentCourse.update(
                { sortOrder: index + 1 },
                { where: { id, createdBy } }
            );
        }

        const updatedGroups = await StudentCourse.findAll({
            where: { createdBy },
            order: [["sortOrder", "ASC"]],
            attributes: ["id", "sortOrder"],
        });

        return {
            status: true,
            message: "Student Course reordered successfully",
            data: updatedGroups,
        };
    } catch (error) {
        console.error("❌ reorderStudentCourse service error:", error);
        return { status: false, message: "Internal server error" };
    }
};

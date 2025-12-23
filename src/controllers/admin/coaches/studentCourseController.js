const path = require("path");
const fs = require("fs");
const { uploadToFTP } = require("../../../utils/uploadToFTP");
const { validateFormData } = require("../../../utils/validateFormData");
const { saveFile } = require("../../../utils/fileHandler");
const studentCourseService = require("../../../services/admin/coaches/studentCourseService");
const { logActivity } = require("../../../utils/admin/activityLogger");
const { createNotification } = require("../../../utils/admin/notificationHelper");

const { getMainSuperAdminOfAdmin } = require("../../../utils/auth");

const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "student course";

exports.createStudentCourse = async (req, res) => {
    try {
        if (DEBUG) {
            console.log("BODY:", req.body);
            console.log("FILES:", req.files.map(f => f.fieldname));
        }

        const adminId = req.admin.id;

        // =========================
        // 1️⃣ Basic validation
        // =========================
        const coverImageFile = req.files.find(
            f => f.fieldname === "coverImage"
        );

        const formData = {
            courseName: req.body.courseName,
            duration: req.body.duration,
            durationType: req.body.durationType,
            level: req.body.level,
            coverImage: coverImageFile,
        };

        const validation = validateFormData(formData, {
            requiredFields: [
                "courseName",
                "duration",
                "durationType",
                "level",
                "coverImage",
            ],
            patternValidations: {
                courseName: "string",
                duration: "number",
                durationType: "string",
                level: "string",
            },
            fileExtensionValidations: {
                coverImage: ["jpg", "jpeg", "png", "webp"],
            },
        });

        if (!validation.isValid) {
            return res.status(422).json({
                status: false,
                message: validation.message,
            });
        }

        // =========================
        // 2️⃣ Parse & validate videos JSON
        // =========================
        let videos = [];
        try {
            videos = JSON.parse(req.body.videos || "[]");

        } catch {
            return res.status(422).json({
                status: false,
                message: "Invalid videos metadata JSON format",
            });
        }

        if (!Array.isArray(videos) || videos.length === 0) {
            return res.status(422).json({
                status: false,
                message: "At least one course video is required",
            });
        }

        // =========================
        // 3️⃣ Upload Cover Image (FIXED)
        // =========================
        const coverImageName = `${Date.now()}_${coverImageFile.originalname}`;
        const coverImageLocalPath = path.join(
            process.cwd(),
            "uploads/temp/studentCourses",
            coverImageName
        );

        await fs.promises.mkdir(path.dirname(coverImageLocalPath), { recursive: true });
        await saveFile(coverImageFile, coverImageLocalPath);

        const coverImageRemotePath =
            `uploads/studentCourses/${adminId}/cover/${coverImageName}`;

        const coverImageUrl = await uploadToFTP(
            coverImageLocalPath,
            coverImageRemotePath
        );

        await fs.promises.unlink(coverImageLocalPath).catch(() => { });

        // =========================
        // 4️⃣ Upload Videos (FIXED)
        // =========================
        const uploadedVideos = [];

        const videoFiles = req.files.filter(f =>
            f.fieldname.startsWith("video_")
        );

        if (videoFiles.length !== videos.length) {
            return res.status(422).json({
                status: false,
                message: "Number of videos and video files do not match"
            });
        }

        for (let i = 0; i < videos.length; i++) {
            const videoMeta = videos[i];
            const file = videoFiles[i];

            const videoName = `${Date.now()}_${file.originalname}`;
            const videoLocalPath = path.join(
                process.cwd(),
                "uploads/temp/studentCourses",
                videoName
            );

            await fs.promises.mkdir(path.dirname(videoLocalPath), { recursive: true });
            await saveFile(file, videoLocalPath);

            const videoRemotePath =
                `uploads/studentCourses/${adminId}/videos/${videoName}`;

            const videoUrl = await uploadToFTP(videoLocalPath, videoRemotePath);
            await fs.promises.unlink(videoLocalPath).catch(() => { });

            uploadedVideos.push({
                name: videoMeta.name,
                videoUrl,
                childFeatures: videoMeta.childFeatures || []
            });
        }

        // =========================
        // 5️⃣ Create Student Course
        // =========================
        const result = await studentCourseService.createStudentCourse({
            courseName: req.body.courseName,
            duration: Number(req.body.duration),
            durationType: req.body.durationType,
            level: req.body.level,
            coverImage: coverImageUrl,
            videos: uploadedVideos,
            createdBy: adminId,
        });

        if (!result.status) {
            return res.status(500).json(result);
        }

        // =========================
        // 6️⃣ Activity Log
        // =========================
        await logActivity(
            req,
            PANEL,
            MODULE,
            "create",
            {
                oneLineMessage: `Created student course: ${req.body.courseName}`,
            },
            true
        );

        // =========================
        // 7️⃣ Notification
        // =========================
        const adminName =
            `${req.admin.firstName || ""} ${req.admin.lastName || ""}`.trim();

        await createNotification(
            req,
            "New Student Course",
            `${adminName} created a new student course`,
            "Support"
        );

        return res.status(201).json({
            status: true,
            message: "Student course created successfully",
            data: result.data,
        });

    } catch (error) {
        if (DEBUG) console.error("❌ Create Student Course Error:", error);

        return res.status(500).json({
            status: false,
            message: "Server error while creating student course",
        });
    }
};

/**
 * Get All Student Courses (Grouped by Level)
 */
exports.getAllStudentCourses = async (req, res) => {
    try {
        // =========================
        // Resolve super admin
        // =========================
        const mainSuperAdminResult = await getMainSuperAdminOfAdmin(req.admin?.id);
        const superAdminId = mainSuperAdminResult?.superAdmin?.id ?? null;

        if (DEBUG) {
            console.log(`🧩 SuperAdminId resolved as: ${superAdminId}`);
        }

        // =========================
        // 1️⃣ Fetch from DB
        // =========================
        const result = await studentCourseService.getAllStudentCourses(
            req.admin.id,
            superAdminId
        );

        if (!result.status) {
            await logActivity(req, PANEL, MODULE, "view", result, false);
            return res.status(500).json(result);
        }

        // =========================
        // 2️⃣ Normalize & parse videos
        // =========================
        const normalizedCourses = result.data.map((course) => {
            const jsonCourse = course.toJSON();

            return {
                ...jsonCourse,
                videos:
                    typeof jsonCourse.videos === "string"
                        ? JSON.parse(jsonCourse.videos)
                        : jsonCourse.videos,
            };
        });

        // =========================
        // 3️⃣ Group by level
        // =========================
        const groupedCourses = {
            Beginner: [],
            Intermediate: [],
            Advanced: [],
        };

        for (const course of normalizedCourses) {
            if (groupedCourses[course.level]) {
                groupedCourses[course.level].push(course);
            }
        }

        // =========================
        // 3️⃣➕ Sort by sortOrder
        // =========================
        Object.keys(groupedCourses).forEach((level) => {
            groupedCourses[level].sort((a, b) => a.sortOrder - b.sortOrder);
        });
        // =========================
        // 4️⃣ Log Activity
        // =========================
        await logActivity(
            req,
            PANEL,
            MODULE,
            "view",
            {
                Beginner: groupedCourses.Beginner.length,
                Intermediate: groupedCourses.Intermediate.length,
                Advanced: groupedCourses.Advanced.length,
            },
            true
        );

        // =========================
        // 5️⃣ Response
        // =========================
        return res.status(200).json({
            status: true,
            message: "Student courses fetched successfully",
            data: groupedCourses,
        });

    } catch (error) {
        console.error("❌ getAllStudentCourses Error:", error);

        await logActivity(
            req,
            PANEL,
            MODULE,
            "view",
            error.message,
            false
        );

        return res.status(500).json({
            status: false,
            message: error.message || "Server error while fetching student courses",
        });
    }
};

/**
 * Get Single Student Course
 */
exports.getStudentCourseById = async (req, res) => {
    try {
        const courseId = req.params.id;

        if (DEBUG) {
            console.log("📥 Course ID:", courseId);
            console.log("👤 Admin ID:", req.admin?.id);
        }

        // =========================
        // Resolve super admin
        // =========================
        const mainSuperAdminResult = await getMainSuperAdminOfAdmin(req.admin?.id);
        const superAdminId = mainSuperAdminResult?.superAdmin?.id ?? null;

        if (DEBUG) {
            console.log(`🧩 SuperAdminId resolved as: ${superAdminId}`);
        }

        // =========================
        // 1️⃣ Fetch from service
        // =========================
        const result = await studentCourseService.getStudentCourseById(
            req.admin.id,
            superAdminId,
            courseId
        );

        // =========================
        // 2️⃣ Handle failure
        // =========================
        if (!result.status) {
            await logActivity(
                req,
                PANEL,
                MODULE,
                "view",
                result.message,
                false
            );

            return res.status(404).json(result);
        }

        // =========================
        // 3️⃣ Parse videos safely
        // =========================
        const course = result.data.toJSON();

        course.videos =
            typeof course.videos === "string"
                ? JSON.parse(course.videos)
                : course.videos;

        if (DEBUG) {
            console.log("📤 Student Course:", course);
        }

        // =========================
        // 4️⃣ Log Activity
        // =========================
        await logActivity(
            req,
            PANEL,
            MODULE,
            "view",
            {
                courseId: course.id,
                courseName: course.courseName,
            },
            true
        );

        // =========================
        // 5️⃣ Response
        // =========================
        return res.status(200).json({
            status: true,
            message: "Student course fetched successfully",
            data: course,
        });

    } catch (error) {
        console.error("❌ getStudentCourseById Error:", error);

        await logActivity(
            req,
            PANEL,
            MODULE,
            "view",
            error.message,
            false
        );

        return res.status(500).json({
            status: false,
            message: error.message || "Server error while fetching student course",
        });
    }
};

/**
 * Update Student Course (ALIGNED WITH CREATE)
 */
exports.updateStudentCourse = async (req, res) => {
    try {
        const adminId = req.admin?.id;
        if (!adminId) {
            return res.status(401).json({ status: false, message: "Unauthorized: admin info missing" });
        }

        const courseId = req.params.id;
        if (!courseId || isNaN(Number(courseId))) {
            return res.status(422).json({ status: false, message: "Invalid student course ID" });
        }
        if (DEBUG) {
            console.log("📥 UPDATE STUDENT COURSE");
            console.log("Course ID:", courseId);
            console.log("BODY:", req.body);
            console.log("FILES:", req.files?.map(f => f.fieldname));
        }

        // =========================
        // 0️⃣ Validate course ID
        // =========================
        if (!courseId || isNaN(Number(courseId))) {
            return res.status(422).json({
                status: false,
                message: "Invalid student course ID",
            });
        }

        // =========================
        // 1️⃣ Partial basic fields
        // =========================
        const updateData = {};

        if (req.body.courseName !== undefined)
            updateData.courseName = req.body.courseName;

        if (req.body.duration !== undefined)
            updateData.duration = Number(req.body.duration);

        if (req.body.durationType !== undefined)
            updateData.durationType = req.body.durationType;

        if (req.body.level !== undefined)
            updateData.level = req.body.level;

        // =========================
        // 2️⃣ Cover image (same as create)
        // =========================
        const coverImageFile = req.files?.find(
            f => f.fieldname === "coverImage"
        );

        if (coverImageFile) {
            const coverImageName = `${Date.now()}_${coverImageFile.originalname}`;
            const coverImageLocalPath = path.join(
                process.cwd(),
                "uploads/temp/studentCourses",
                coverImageName
            );

            await fs.promises.mkdir(path.dirname(coverImageLocalPath), { recursive: true });
            await saveFile(coverImageFile, coverImageLocalPath);

            const coverImageRemotePath =
                `uploads/studentCourses/${adminId}/cover/${coverImageName}`;

            updateData.coverImage = await uploadToFTP(
                coverImageLocalPath,
                coverImageRemotePath
            );

            await fs.promises.unlink(coverImageLocalPath).catch(() => { });
        }

        // =========================
        // 3️⃣ Videos (EXACT SAME LOGIC AS CREATE)
        // =========================
        if (req.body.videos !== undefined) {
            let videos = [];

            try {
                videos = JSON.parse(req.body.videos || "[]");
            } catch {
                return res.status(422).json({
                    status: false,
                    message: "Invalid videos JSON",
                });
            }

            const uploadedVideos = [];

            for (const meta of videos) {
                let videoUrl = meta.videoUrl || null;

                // 🎯 Find matching file using fileKey
                if (meta.fileKey) {
                    const file = req.files?.find(
                        f => f.fieldname === meta.fileKey
                    );

                    if (file) {
                        const videoName = `${Date.now()}_${file.originalname}`;
                        const localPath = path.join(
                            process.cwd(),
                            "uploads/temp/studentCourses",
                            videoName
                        );

                        await fs.promises.mkdir(path.dirname(localPath), { recursive: true });
                        await saveFile(file, localPath);

                        const remotePath =
                            `uploads/studentCourses/${adminId}/videos/${videoName}`;

                        videoUrl = await uploadToFTP(localPath, remotePath);
                        await fs.promises.unlink(localPath).catch(() => { });
                    }
                }

                uploadedVideos.push({
                    id: meta.id || undefined, // keep id if exists
                    name: meta.name,
                    videoUrl,
                    childFeatures: meta.childFeatures || [],
                });
            }

            updateData.videos = uploadedVideos;
        }

        if (DEBUG) {
            console.log("📦 FINAL UPDATE PAYLOAD:", updateData);
        }

        // =========================
        // 4️⃣ Update DB
        // =========================
        const superAdminId = (await getMainSuperAdminOfAdmin(adminId))?.superAdmin?.id || null;
        const result = await studentCourseService.updateStudentCourseById(adminId, superAdminId, courseId, updateData);

        if (!result.status) return res.status(404).json(result);

        if (!result.status) {
            return res.status(404).json(result);
        }

        return res.status(200).json({
            status: true,
            message: "Student course updated successfully",
            data: result.data,
        });

    } catch (error) {
        console.error("❌ Update Student Course Error:", error);
        return res.status(500).json({
            status: false,
            message: "Server error while updating student course",
        });
    }
};

/**
 * Delete Student Course (Soft Delete)
 */
exports.deleteStudentCourse = async (req, res) => {
    try {
        const adminId = req.admin.id;
        const courseId = req.params.id;

        if (DEBUG) {
            console.log("🗑️ Delete Course ID:", courseId);
            console.log("👤 Admin ID:", adminId);
        }

        // =========================
        // 0️⃣ Validate courseId
        // =========================
        if (!courseId || isNaN(Number(courseId))) {
            return res.status(422).json({
                status: false,
                message: "Invalid student course ID",
            });
        }

        // =========================
        // 1️⃣ Resolve super admin
        // =========================
        const mainSuperAdminResult = await getMainSuperAdminOfAdmin(adminId);
        const superAdminId = mainSuperAdminResult?.superAdmin?.id ?? null;

        if (DEBUG) {
            console.log(`🧩 SuperAdminId resolved as: ${superAdminId}`);
        }

        // =========================
        // 2️⃣ Call delete service
        // =========================
        const result = await studentCourseService.deleteStudentCourseById(
            adminId,
            superAdminId,
            courseId
        );

        if (!result.status) {
            await logActivity(
                req,
                PANEL,
                MODULE,
                "delete",
                result.message,
                false
            );

            return res.status(404).json(result);
        }

        // =========================
        // 3️⃣ Activity Log
        // =========================
        await logActivity(
            req,
            PANEL,
            MODULE,
            "delete",
            {
                oneLineMessage: `Deleted student course ID: ${courseId}`,
            },
            true
        );

        // =========================
        // 4️⃣ Notification (optional)
        // =========================
        const adminName =
            `${req.admin.firstName || ""} ${req.admin.lastName || ""}`.trim();

        await createNotification(
            req,
            "Student Course Deleted",
            `${adminName} deleted a student course`,
            "Support"
        );

        // =========================
        // 5️⃣ Response
        // =========================
        return res.status(200).json({
            status: true,
            message: "Student course deleted successfully",
        });

    } catch (error) {
        if (DEBUG) console.error("❌ Delete Student Course Error:", error);

        await logActivity(
            req,
            PANEL,
            MODULE,
            "delete",
            error.message,
            false
        );

        return res.status(500).json({
            status: false,
            message: "Server error while deleting student course",
        });
    }
};

/**
 * Reorder Student Course
 */
exports.reorderStudentCourse = async (req, res) => {
    const { orderedIds } = req.body;
    const adminId = req.admin?.id;

    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
        return res.status(400).json({
            status: false,
            message: "orderedIds must be a non-empty array",
        });
    }

    try {
        const result = await studentCourseService.reorderStudentCourse(
            orderedIds,
            adminId
        );

        if (!result.status) {
            return res.status(500).json({
                status: false,
                message: result.message || "Failed to reorder student course",
            });
        }

        await logActivity(
            req,
            PANEL,
            MODULE,
            "reorder",
            {
                oneLineMessage: `Reordered ${orderedIds.length} student course`,
            },
            true
        );

        return res.status(200).json({
            status: true,
            message: "Student Course reordered successfully",
            data: result.data,
        });
    } catch (error) {
        console.error("❌ reorderStudentCourse controller error:", error);
        return res.status(500).json({
            status: false,
            message: "Failed to reorder student course",
        });
    }
};

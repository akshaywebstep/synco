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
            console.log("FILES:", Object.keys(req.files || {}));
        }

        const adminId = req.admin.id;

        // =========================
        // 1️⃣ Basic validation
        // =========================
        const formData = {
            courseName: req.body.courseName,
            duration: req.body.duration,
            durationType: req.body.durationType,
            level: req.body.level,
            coverImage: req.files?.coverImage?.[0],
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
                message: "Invalid videos JSON format",
            });
        }

        if (!Array.isArray(videos) || videos.length === 0) {
            return res.status(422).json({
                status: false,
                message: "At least one course video is required",
            });
        }

        if (!req.files?.videos || req.files.videos.length !== videos.length) {
            return res.status(422).json({
                status: false,
                message: "Videos metadata count and uploaded files count must match",
            });
        }

        // =========================
        // 3️⃣ Upload Cover Image
        // =========================
        const coverImageFile = req.files.coverImage[0];
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
        // 4️⃣ Upload Course Videos (index-based mapping)
        // =========================
        const uploadedVideos = [];

        for (let i = 0; i < videos.length; i++) {
            const videoFile = req.files.videos[i];

            const videoName = `${Date.now()}_${videoFile.originalname}`;
            const videoLocalPath = path.join(
                process.cwd(),
                "uploads/temp/studentCourses",
                videoName
            );

            await fs.promises.mkdir(path.dirname(videoLocalPath), { recursive: true });
            await saveFile(videoFile, videoLocalPath);

            const videoRemotePath =
                `uploads/studentCourses/${adminId}/videos/${videoName}`;

            const videoUrl = await uploadToFTP(videoLocalPath, videoRemotePath);
            await fs.promises.unlink(videoLocalPath).catch(() => { });

            uploadedVideos.push({
                name: videos[i].name,
                videoUrl,
                childFeatures: videos[i].childFeatures || [],
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

        if (DEBUG) console.log("📤 groupedCourses:", groupedCourses);

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
 * Update Student Course
 */
exports.updateStudentCourse = async (req, res) => {
    try {
        const adminId = req.admin.id;
        const courseId = req.params.id;

        if (DEBUG) {
            console.log("BODY:", req.body);
            console.log("FILES:", Object.keys(req.files || {}));
            console.log("Course ID:", courseId);
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
        // 1️⃣ Basic form validation
        // =========================
        const formData = {
            courseName: req.body.courseName,
            duration: req.body.duration,
            durationType: req.body.durationType,
            level: req.body.level,
            coverImage: req.files?.coverImage?.[0],
        };

        const validation = validateFormData(formData, {
            requiredFields: ["courseName", "duration", "durationType", "level"],
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
                message: "Invalid videos JSON format",
            });
        }

        if (!Array.isArray(videos)) {
            return res.status(422).json({
                status: false,
                message: "Videos must be an array",
            });
        }

        if (req.files?.videos && req.files.videos.length !== videos.length) {
            return res.status(422).json({
                status: false,
                message: "Videos metadata count and uploaded files count must match",
            });
        }

        // =========================
        // 3️⃣ Handle cover image upload (if new)
        // =========================
        let coverImageUrl = req.body.existingCoverImage || null;
        if (req.files?.coverImage?.[0]) {
            const coverImageFile = req.files.coverImage[0];
            const coverImageName = `${Date.now()}_${coverImageFile.originalname}`;
            const coverImageLocalPath = path.join(
                process.cwd(),
                "uploads/temp/studentCourses",
                coverImageName
            );

            await fs.promises.mkdir(path.dirname(coverImageLocalPath), { recursive: true });
            await saveFile(coverImageFile, coverImageLocalPath);

            const coverImageRemotePath = `uploads/studentCourses/${adminId}/cover/${coverImageName}`;
            coverImageUrl = await uploadToFTP(coverImageLocalPath, coverImageRemotePath);
            await fs.promises.unlink(coverImageLocalPath).catch(() => { });
        }

        // =========================
        // 4️⃣ Handle course videos upload
        // =========================
        const uploadedVideos = [];
        for (let i = 0; i < videos.length; i++) {
            const videoFile = req.files?.videos?.[i];
            let videoUrl = videos[i].videoUrl || null;

            if (videoFile) {
                const videoName = `${Date.now()}_${videoFile.originalname}`;
                const videoLocalPath = path.join(
                    process.cwd(),
                    "uploads/temp/studentCourses",
                    videoName
                );

                await fs.promises.mkdir(path.dirname(videoLocalPath), { recursive: true });
                await saveFile(videoFile, videoLocalPath);

                const videoRemotePath = `uploads/studentCourses/${adminId}/videos/${videoName}`;
                videoUrl = await uploadToFTP(videoLocalPath, videoRemotePath);
                await fs.promises.unlink(videoLocalPath).catch(() => { });
            }

            uploadedVideos.push({
                name: videos[i].name,
                videoUrl,
                childFeatures: videos[i].childFeatures || [],
            });
        }

        // =========================
        // 5️⃣ Resolve super admin
        // =========================
        const mainSuperAdminResult = await getMainSuperAdminOfAdmin(adminId);
        const superAdminId = mainSuperAdminResult?.superAdmin?.id ?? null;

        // =========================
        // 6️⃣ Call service to update
        // =========================
        const result = await studentCourseService.updateStudentCourseById(
            adminId,
            superAdminId,
            courseId,
            {
                courseName: req.body.courseName,
                duration: Number(req.body.duration),
                durationType: req.body.durationType,
                level: req.body.level,
                coverImage: coverImageUrl,
                videos: uploadedVideos,
            }
        );

        if (!result.status) {
            return res.status(500).json(result);
        }

        // =========================
        // 7️⃣ Activity Log
        // =========================
        await logActivity(
            req,
            PANEL,
            MODULE,
            "update",
            { oneLineMessage: `Updated student course: ${req.body.courseName}` },
            true
        );

        return res.status(200).json({
            status: true,
            message: "Student course updated successfully",
            data: result.data,
        });

    } catch (error) {
        if (DEBUG) console.error("❌ Update Student Course Error:", error);

        return res.status(500).json({
            status: false,
            message: "Server error while updating student course",
        });
    }
};

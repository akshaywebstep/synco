const path = require("path");
const fs = require("fs");
const uploadToFTP = require("../../../utils/uploadToFTP");

const { validateFormData } = require("../../../utils/validateFormData");
const { saveFile } = require("../../../utils/fileHandler");
const SessionExerciseService = require("../../../services/admin/sessionPlan/sessionExercise");
const { logActivity } = require("../../../utils/admin/activityLogger");

const {
    createNotification,
} = require("../../../utils/admin/notificationHelper");

const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "session-plan-exercise";

exports.createSessionExercise = async (req, res) => {
    try {
        const formData = req.body;
        const files = req.files || [];
        const createdBy = req.admin?.id || req.user?.id;

        if (!createdBy) {
            console.error("❌ Unauthorized request: createdBy not found");
            return res.status(403).json({ status: false, message: "Unauthorized request" });
        }

        console.log("🔍 STEP 1: Received create request:", formData);

        // Normalize files to a flat array
        let filesArray = [];
        if (Array.isArray(files)) {
            filesArray = files;
        } else {
            filesArray = Object.values(files).flat();
        }

        if (filesArray.length > 0) {
            console.log("📎 Files uploaded:", filesArray.map(f => f.originalname));
        }

        // Validate file extensions
        const allowedExtensions = ["jpg", "jpeg", "png", "webp"];
        for (const file of filesArray) {
            const ext = path.extname(file.originalname).toLowerCase().slice(1);
            if (!allowedExtensions.includes(ext)) {
                console.error("❌ Invalid file type:", file.originalname);
                return res.status(400).json({ status: false, message: `Invalid file type: ${file.originalname}` });
            }
        }

        // Validate required fields
        const validation = validateFormData(formData, { requiredFields: ["title"] });
        if (!validation.isValid) {
            console.error("❌ Validation failed:", validation.error);
            await logActivity(req, PANEL, MODULE, "create", validation.error, false);
            return res.status(400).json(validation);
        }

        // STEP 2: Create DB row first (without images)
        console.log("📌 STEP 2: Creating exercise in DB without images");
        const createResult = await SessionExerciseService.createSessionExercise({
            title: formData.title,
            duration: formData.duration || null,
            description: formData.description || null,
            imageUrl: [], // temporarily empty
            createdBy,
        });

        if (!createResult.status) {
            console.error("❌ DB create failed:", createResult.message);
            await logActivity(req, PANEL, MODULE, "create", createResult, false);
            return res.status(500).json({ status: false, message: createResult.message || "Failed to create exercise" });
        }

        const exercise = createResult.data;
        const exerciseId = exercise.id;
        console.log("✅ STEP 2: Exercise created with ID:", exerciseId);

        // STEP 3: Upload files using exercise ID folder
        const baseUploadDir = path.join(process.cwd(), "uploads", "temp", "admin", `${createdBy}`, "sessionExercise", `${exerciseId}`);
        console.log("📂 STEP 3: Base upload directory:", baseUploadDir);

        const uploadedUrls = [];

        for (const file of filesArray) {
            const uniqueId = Date.now() + "_" + Math.floor(Math.random() * 1e9);
            const ext = path.extname(file.originalname).toLowerCase();
            const fileName = `${uniqueId}${ext}`;
            const localPath = path.join(baseUploadDir, fileName);

            console.log("📌 STEP 3a: Saving local file:", localPath);
            await fs.promises.mkdir(path.dirname(localPath), { recursive: true });
            await saveFile(file, localPath);

            try {
                console.log("⬆️ STEP 3b: Uploading to FTP:", localPath);
                const publicUrl = await uploadToFTP(localPath, fileName);
                if (publicUrl) {
                    uploadedUrls.push(publicUrl);
                    console.log("✅ STEP 3c: Uploaded successfully:", publicUrl);
                } else {
                    console.error("❌ STEP 3c: Upload returned null for", localPath);
                }
            } catch (err) {
                console.error("❌ STEP 3b: FTP upload failed for", localPath, err.message);
            } finally {
                await fs.promises.unlink(localPath).catch(() => { });
                console.log("🗑️ STEP 3d: Local temp file deleted:", localPath);
            }
        }

        // STEP 4: Update DB with uploaded URLs (still part of creation)
        console.log("📌 STEP 4: Saving uploaded URLs to DB");
        const updateResult = await SessionExerciseService.updateSessionExercise(exerciseId, { imageUrl: uploadedUrls }, createdBy);
        const updatedExercise = updateResult.data;
        console.log("✅ STEP 4: Exercise saved with images:", uploadedUrls);

        // STEP 5: Log activity + create notification
        console.log("📌 STEP 5: Logging activity and sending notification");
        await logActivity(req, PANEL, MODULE, "create", updateResult, true);
        await createNotification(
            req,
            "New Session Exercise Created",
            `Session Exercise '${formData.title}' was created by ${req?.admin?.firstName || "Admin"}.`,
            "System"
        );
        console.log("✅ STEP 5: Notification created");

        // STEP 6: Respond
        console.log("📦 STEP 6: Responding with created exercise");
        return res.status(201).json({
            status: true,
            message: "Exercise created successfully",
            data: updatedExercise,
        });

    } catch (error) {
        console.error("❌ STEP 0: Server error:", error);
        await logActivity(req, PANEL, MODULE, "create", { oneLineMessage: error.message }, false);
        return res.status(500).json({ status: false, message: "Server error." });
    }
};

// ✅ Get By ID
exports.getSessionExerciseById = async (req, res) => {
    const { id } = req.params;
    const adminId = req.admin?.id; // get adminId from auth middleware

    try {
        const result = await SessionExerciseService.getSessionExerciseById(
            id,
            adminId
        ); // pass adminId

        if (!result.status) {
            await logActivity(req, PANEL, MODULE, "getById", result, false);
            return res.status(404).json({ status: false, message: result.message });
        }

        await logActivity(req, PANEL, MODULE, "getById", result, true);
        return res.status(200).json({
            status: true,
            message: "Fetched exercise successfully",
            data: result.data,
        });
    } catch (error) {
        console.error("❌ GetById error:", error);
        await logActivity(
            req,
            PANEL,
            MODULE,
            "getById",
            { oneLineMessage: error.message },
            false
        );
        return res.status(500).json({ status: false, message: "Server error." });
    }
};

// ✅ Get All
exports.getAllSessionExercises = async (req, res) => {
    if (DEBUG) console.log("📥 Fetching all exercises...");

    try {
        const adminId = req.admin.id;

        const result = await SessionExerciseService.getAllSessionExercises(adminId);

        if (!result.status) {
            if (DEBUG) console.log("⚠️ Fetch failed:", result.message);
            await logActivity(req, PANEL, MODULE, "list", result, false);
            return res.status(500).json({ status: false, message: result.message });
        }

        if (DEBUG) {
            console.log("✅ Exercises fetched successfully");
            console.table(result.data);
        }

        await logActivity(
            req,
            PANEL,
            MODULE,
            "list",
            {
                oneLineMessage: `Fetched ${result.data.length || 0
                    } exercises for admin ${adminId}`,
            },
            true
        );

        return res.status(200).json({
            status: true,
            message: "Fetched exercises successfully",
            data: result.data,
        });
    } catch (error) {
        console.error("❌ Fetch error:", error);
        await logActivity(
            req,
            PANEL,
            MODULE,
            "list",
            { oneLineMessage: error.message },
            false
        );
        return res.status(500).json({ status: false, message: "Server error." });
    }
};

// ✅ Update (aligned with createSessionExercise)
exports.updateSessionExercise = async (req, res) => {
    try {
        const { id } = req.params;
        const adminId = req.admin?.id || req.user?.id;
        const updates = req.body;
        const files = req.files || [];

        if (!adminId) {
            console.error("❌ Unauthorized request: adminId not found");
            return res.status(403).json({ status: false, message: "Unauthorized request" });
        }

        console.log("🔍 STEP 1: Received update request:", updates);

        // Normalize files to a flat array
        let filesArray = [];
        if (Array.isArray(files)) {
            filesArray = files;
        } else {
            filesArray = Object.values(files).flat();
        }

        if (filesArray.length > 0) {
            console.log("📎 Files uploaded:", filesArray.map(f => f.originalname));
        }

        // Validate file extensions
        const allowedExtensions = ["jpg", "jpeg", "png", "webp"];
        for (const file of filesArray) {
            const ext = path.extname(file.originalname).toLowerCase().slice(1);
            if (!allowedExtensions.includes(ext)) {
                console.error("❌ Invalid file type:", file.originalname);
                return res.status(400).json({ status: false, message: `Invalid file type: ${file.originalname}` });
            }
        }

        // ✅ STEP 2: Fetch existing exercise
        console.log("📌 STEP 2: Fetching existing exercise");
        const existing = await SessionExerciseService.getSessionExerciseById(id, adminId);

        if (!existing.status || !existing.data) {
            console.warn("⚠️ Exercise not found for ID:", id);
            return res.status(404).json({ status: false, message: "Exercise not found" });
        }
        console.log("✅ STEP 2: Found exercise:", existing.data.title);

        // ✅ STEP 3: Upload files (if any)
        const uploadedUrls = [];
        if (filesArray.length > 0) {
            const baseUploadDir = path.join(process.cwd(), "uploads", "temp", "admin", `${adminId}`, "sessionExercise", `${id}`);
            console.log("📂 STEP 3: Base upload directory:", baseUploadDir);

            for (const file of filesArray) {
                const uniqueId = Date.now() + "_" + Math.floor(Math.random() * 1e9);
                const ext = path.extname(file.originalname).toLowerCase();
                const fileName = `${uniqueId}${ext}`;
                const localPath = path.join(baseUploadDir, fileName);

                console.log("📌 STEP 3a: Saving local file:", localPath);
                await fs.promises.mkdir(path.dirname(localPath), { recursive: true });
                await saveFile(file, localPath);

                try {
                    console.log("⬆️ STEP 3b: Uploading to FTP:", localPath);
                    const publicUrl = await uploadToFTP(localPath, fileName);
                    if (publicUrl) {
                        uploadedUrls.push(publicUrl);
                        console.log("✅ STEP 3c: Uploaded successfully:", publicUrl);
                    } else {
                        console.error("❌ STEP 3c: Upload returned null for", localPath);
                    }
                } catch (err) {
                    console.error("❌ STEP 3b: FTP upload failed for", localPath, err.message);
                } finally {
                    await fs.promises.unlink(localPath).catch(() => { });
                    console.log("🗑️ STEP 3d: Local temp file deleted:", localPath);
                }
            }
        }

        // ✅ STEP 4: Decide which images to keep
        if (uploadedUrls.length) {
            updates.imageUrl = uploadedUrls;
            console.log("🖼️ Replacing images with new uploads:", uploadedUrls);
        } else if (updates.imageUrl === null) {
            updates.imageUrl = [];
            console.log("🗑️ Clearing all images");
        } else {
            updates.imageUrl = Array.isArray(existing.data.imageUrl)
                ? existing.data.imageUrl
                : JSON.parse(existing.data.imageUrl || "[]");
            console.log("🔄 Keeping existing images:", updates.imageUrl);
        }

        updates.updatedBy = adminId;

        // ✅ STEP 5: Update DB
        console.log("📌 STEP 5: Updating exercise in DB");
        const result = await SessionExerciseService.updateSessionExercise(id, updates, adminId);

        if (!result.status) {
            console.error("❌ DB update failed:", result.message);
            await logActivity(req, PANEL, MODULE, "update", result, false);
            return res.status(500).json(result);
        }

        console.log("✅ STEP 5: Exercise updated in DB");

        // ✅ STEP 6: Log + Notify
        console.log("📌 STEP 6: Logging activity and creating notification");
        await logActivity(req, PANEL, MODULE, "update", result, true);

        await createNotification(
            req,
            "Session Exercise Updated",
            `Session Exercise '${updates.title || existing.data.title}' was updated by ${req?.admin?.firstName || "Admin"}.`,
            "System"
        );
        console.log("✅ STEP 6: Notification created");

        // ✅ STEP 7: Respond
        console.log("📦 STEP 7: Responding with updated exercise");
        return res.status(200).json({
            status: true,
            message: "Exercise updated successfully",
            data: result.data,
        });
    } catch (error) {
        console.error("❌ STEP 0: Update server error:", error);
        await logActivity(req, PANEL, MODULE, "update", { oneLineMessage: error.message }, false);
        return res.status(500).json({ status: false, message: "Server error." });
    }
};

// ✅ Delete
exports.deleteSessionExercise = async (req, res) => {
    const { id } = req.params;
    const adminId = req.admin?.id; // ✅ Make sure to get adminId

    try {
        const result = await SessionExerciseService.deleteSessionExercise(
            id,
            adminId
        ); // ✅ pass adminId
        if (!result.status) {
            await logActivity(req, PANEL, MODULE, "delete", result, false);
            return res.status(404).json(result);
        }

        await logActivity(
            req,
            PANEL,
            MODULE,
            "delete",
            { oneLineMessage: `Deleted exercise ID: ${id}` },
            true
        );

        // ✅ Send notification
        await createNotification(
            req,
            "Session Exercise Deleted",
            `Session Exercise ID '${id}' was deleted by ${req?.admin?.name || "Admin"
            }.`,
            "System"
        );

        return res.status(200).json({
            status: true,
            message: "Exercise deleted successfully",
        });
    } catch (error) {
        console.error("❌ Delete error:", error);
        await logActivity(
            req,
            PANEL,
            MODULE,
            "delete",
            { oneLineMessage: error.message },
            false
        );
        return res.status(500).json({ status: false, message: "Server error." });
    }
};

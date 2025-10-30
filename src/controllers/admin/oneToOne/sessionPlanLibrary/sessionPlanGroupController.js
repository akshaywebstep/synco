const { validateFormData } = require("../../../../utils/validateFormData");
const SessionPlanGroupService = require("../../../../services/admin/oneToOne/sessionPlanLibrary/sessionPlanGroup");
const SessionExerciseService = require("../../../../services/admin/oneToOne/sessionPlanLibrary/sessionExercise");

const { logActivity } = require("../../../../utils/admin/activityLogger");
const { downloadFromFTP, uploadToFTP } = require("../../../../utils/uploadToFTP");
const { Readable } = require("stream");

const { getVideoDurationInSeconds, formatDuration, } = require("../../../../utils/videoHelper");
const {
  createNotification,
} = require("../../../../utils/admin/notificationHelper");
const { SessionExercise, SessionPlanGroup } = require("../../../../models");
const path = require("path");
const { saveFile, deleteFile } = require("../../../../utils/fileHandler");
const { getMainSuperAdminOfAdmin } = require("../../../../utils/auth");

const fs = require("fs");
const os = require("os");

const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "session-plan-structure";

const validateLevels = (levels) => {
  const requiredFields = ["skillOfTheDay", "description", "sessionExerciseId"];

  for (const [levelName, exercises] of Object.entries(levels)) {
    if (!Array.isArray(exercises)) {
      return `${levelName} should be an array`;
    }

    for (let i = 0; i < exercises.length; i++) {
      const exercise = exercises[i];

      for (const field of requiredFields) {
        if (
          exercise[field] === undefined ||
          exercise[field] === null ||
          (typeof exercise[field] === "string" &&
            exercise[field].trim() === "") ||
          (Array.isArray(exercise[field]) && exercise[field].length === 0)
        ) {
          return `${field} is required`; // 👈 return first error only
        }
      }
    }
  }

  return null; // ✅ no errors
};

exports.createSessionPlanGroupStructure = async (req, res) => {
  try {
    const formData = req.body || {};
    const createdBy = req.admin?.id || req.user?.id;

    // Normalize req.files
    let filesMap = {};
    if (Array.isArray(req.files)) {
      filesMap = req.files.reduce((acc, f) => {
        acc[f.fieldname] = acc[f.fieldname] || [];
        acc[f.fieldname].push(f);
        return acc;
      }, {});
    } else {
      filesMap = req.files || {};
    }

    if (!createdBy)
      return res
        .status(403)
        .json({ status: false, message: "Unauthorized request" });

    const { groupName, levels, player } = formData;

    // Validate required fields
    const validation = validateFormData(formData, {
      requiredFields: ["groupName", "player", "levels"],
    });

    if (!validation.isValid) {
      const firstErrorMsg = Object.values(validation.error)[0];
      return res
        .status(400)
        .json({ status: false, message: firstErrorMsg });
    }

    // Parse levels JSON
    let parsedLevels;
    try {
      parsedLevels =
        typeof levels === "string" ? JSON.parse(levels) : levels;
    } catch {
      return res
        .status(400)
        .json({ status: false, message: "Invalid JSON for levels" });
    }

    // Validate levels
    const levelError = validateLevels(parsedLevels);
    if (levelError)
      return res.status(400).json({ status: false, message: levelError });

    // ===============================
    // STEP 1: Handle uploads FIRST
    // ===============================

    const baseUploadDir = path.join(
      process.cwd(),
      "uploads",
      "temp",
      "admin",
      `${createdBy}`,
      "session-plan-group"
    );

    // Helper to save & upload files (unchanged)
    const saveAndUploadFile = async (file, type) => {
      const uniqueId = Math.floor(Math.random() * 1e9);
      const ext = path.extname(file.originalname).toLowerCase();
      const fileName = `${Date.now()}_${uniqueId}${ext}`;

      const localPath = path.join(baseUploadDir, type, fileName);
      await fs.promises.mkdir(path.dirname(localPath), { recursive: true });

      if (file.buffer) {
        await fs.promises.writeFile(localPath, file.buffer);
      } else {
        await saveFile(file, localPath);
      }

      const relativeFtpPath = path
        .relative(path.join(process.cwd(), "uploads"), localPath)
        .replace(/\\/g, "/");

      let uploadedPath = null;
      try {
        uploadedPath = await uploadToFTP(localPath, relativeFtpPath);
      } catch (err) {
        console.error(`Failed to upload ${type}:`, err.message);
      } finally {
        await fs.promises.unlink(localPath).catch(() => { });
      }

      return uploadedPath;
    };

    // STEP 2: Upload banner
    const banner = filesMap.banner?.[0]
      ? await saveAndUploadFile(filesMap.banner[0], "banner")
      : null;

    // STEP 3: Upload level-wise uploads & videos
    const attachUploadsAndVideos = async () => {
      const uploadFields = {};
      for (const level of ["beginner", "intermediate", "advanced", "pro"]) {
        const fileArr = filesMap[`${level}_upload`];
        uploadFields[`${level}_upload`] = fileArr?.[0]
          ? await saveAndUploadFile(fileArr[0], path.join("upload", level))
          : " ";

        const videoArr = filesMap[`${level}_video`];
        uploadFields[`${level}_video`] = videoArr?.[0]
          ? await saveAndUploadFile(videoArr[0], path.join("video", level))
          : " ";
      }
      return uploadFields;
    };

    const uploadFields = await attachUploadsAndVideos();

    // STEP 4: Create entry directly in SessionPlanGroup (no SessionPlanConfig)
    const payload = {
      groupName,
      levels: parsedLevels,
      player,
      createdBy,
      banner,
      type: "one_to_one", // ✅ Save type directly
      ...uploadFields,
    };

    const result = await SessionPlanGroupService.createSessionPlanGroup(payload);

    if (!result.status)
      return res.status(400).json({
        status: false,
        message: result.message || "Failed to create session plan group.",
      });

    const sessionPlanId = result.data.id;

    // STEP 5: Response
    const responseData = {
      id: sessionPlanId,
      groupName: result.data.groupName,
      type: result.data.type,
      player: result.data.player,
      sortOrder: result.data.sortOrder || 0,
      createdAt: result.data.createdAt,
      updatedAt: result.data.updatedAt,
      banner,
      beginner_upload: uploadFields.beginner_upload,
      intermediate_upload: uploadFields.intermediate_upload,
      advanced_upload: uploadFields.advanced_upload,
      pro_upload: uploadFields.pro_upload,
      beginner_video: uploadFields.beginner_video,
      intermediate_video: uploadFields.intermediate_video,
      advanced_video: uploadFields.advanced_video,
      pro_video: uploadFields.pro_video,
      levels: parsedLevels,
    };
    await createNotification(
      req,
      "Session Plan Group Created",
      `The session plan group '${payload.groupName}' was updated by ${req?.admin?.firstName || "Admin"}.`,
      "System"
    );
    await logActivity(
      req,
      "Admin", // PANEL name
      "session-plan-structure", // MODULE name
      "update", // Action type
      {
        oneLineMessage: `Session Plan Group '${payload.groupName}'  created by ${req?.admin?.firstName || "Admin"}.`
      },
      true
    );
    return res.status(201).json({
      status: true,
      message: "Session Plan Group created successfully.",
      data: responseData,
    });
  } catch (error) {
    console.error("Server error in createSessionPlanGroup:", error);
    return res.status(500).json({
      status: false,
      message:
        "Server error occurred while creating the session plan group.",
    });
  }
};

// exports.getSessionPlanGroupStructureById = async (req, res) => {
//   try {
//     const { id } = req.params; // ✔ use `id` instead of configId
//     const createdBy = req.admin?.id || req.user?.id;

//     if (!id) {
//       return res.status(400).json({
//         status: false,
//         message: "Session Plan Group ID is required.",
//       });
//     }

//     // Now you can safely call your service
//     const result = await SessionPlanGroupService.getSessionPlanConfigById(id, createdBy);

//     if (!result.status) {
//       return res.status(404).json({ status: false, message: result.message });
//     }

//     const group = result.data;
//     let parsedLevels = {};

//     try {
//       parsedLevels =
//         typeof group.levels === "string"
//           ? JSON.parse(group.levels)
//           : group.levels || {};
//     } catch (err) {
//       parsedLevels = {};
//       console.error("Failed to parse levels:", err);
//     }

//     // … rest of your code (exercise enrichment, video info, etc.)

//     return res.status(200).json({
//       status: true,
//       message: "Fetched session plan group successfully.",
//       data: {
//         ...group,
//         // levels: parsedLevels,
//       },
//     });
//   } catch (error) {
//     console.error("Error in getSessionPlanGroupStructureById:", error);
//     return res.status(500).json({ status: false, message: "Server error." });
//   }
// };

exports.getSessionPlanGroupStructureById = async (req, res) => {
  try {
    const { id } = req.params;
    const createdBy = req.admin?.id || req.user?.id;

    const mainSuperAdminResult = await getMainSuperAdminOfAdmin(req.admin.id);
    const superAdminId = mainSuperAdminResult?.superAdmin.id ?? null;

    if (DEBUG)
      console.log("Fetching session plan group id:", id, "user:", createdBy);

    const result = await SessionPlanGroupService.getSessionPlanConfigById(id, superAdminId);

    if (!result.status) {
      if (DEBUG) console.warn("Session plan group not found:", id);
      return res.status(404).json({ status: false, message: result.message });
    }

    const group = result.data;
    let parsedLevels = {};

    try {
      parsedLevels =
        typeof group.levels === "string"
          ? JSON.parse(group.levels)
          : group.levels || {};
    } catch (err) {
      if (DEBUG) console.error("Failed to parse levels:", err);
      parsedLevels = {};
    }

    const sessionExercises = await SessionExercise.findAll({ where: { createdBy } });
    const exerciseMap = sessionExercises.reduce((acc, ex) => {
      acc[ex.id] = ex;
      return acc;
    }, {});

    // ✅ Helper to calculate elapsed time
    const getElapsedTime = (createdAt) => {
      const now = new Date();
      const created = new Date(createdAt);
      const diffMs = now - created;
      const diffSeconds = Math.floor(diffMs / 1000);
      const diffMinutes = Math.floor(diffSeconds / 60);
      const diffHours = Math.floor(diffMinutes / 60);
      const diffDays = Math.floor(diffHours / 24);

      if (diffDays > 0) return `${diffDays} day(s) ago`;
      if (diffHours > 0) return `${diffHours} hour(s) ago`;
      if (diffMinutes > 0) return `${diffMinutes} minute(s) ago`;
      return `${diffSeconds} second(s) ago`;
    };

    // ✅ Process all levels in parallel (faster)
    const levels = ["beginner", "intermediate", "advanced", "pro"];
    const videoInfo = {};

    await Promise.all(
      levels.map(async (level) => {
        const videoUrl = group[`${level}_video`];
        if (videoUrl) {
          const durationSec = await getVideoDurationInSeconds(videoUrl);
          const durationFormatted = formatDuration(durationSec);
          const uploadedAgo = getElapsedTime(group.createdAt);

          videoInfo[`${level}_video_duration`] = durationFormatted;
          videoInfo[`${level}_video_uploadedAgo`] = uploadedAgo;
        } else {
          videoInfo[`${level}_video_duration`] = null;
          videoInfo[`${level}_video_uploadedAgo`] = null;
        }
      })
    );

    if (DEBUG) console.log("Video info added to response:", videoInfo);

    return res.status(200).json({
      status: true,
      message: "Fetched session plan group with video durations.",
      data: {
        ...group,
        levels: parsedLevels,
        ...videoInfo, // ✅ durations & uploadedAgo are flattened
      },
    });
  } catch (error) {
    if (DEBUG) console.error("Error in getSessionPlanGroupDetails:", error);
    return res.status(500).json({ status: false, message: "Server error." });
  }
};

exports.getAllSessionPlanGroupStructure = async (req, res) => {
  try {
    const createdBy = req.admin?.id || req.user?.id;
    if (!createdBy) {
      return res.status(400).json({
        status: false,
        message: "Unauthorized request: missing admin or user ID.",
      });
    }
    console.log("🟢 createdBy:", createdBy);

    // Get top-level super admin (if exists)
    const mainSuperAdminResult = await getMainSuperAdminOfAdmin(req.admin.id);
    const superAdminId = mainSuperAdminResult?.superAdmin.id ?? createdBy;
    // Fetch directly from SessionPlanGroup (type = one_to_one)
    const result = await SessionPlanGroupService.getAllSessionPlanConfig({ createdBy });
    if (!result.status) {
      console.error("❌ Service returned an error:", result.message);
      return res.status(500).json({ status: false, message: result.message });
    }

    const { groups, exerciseMap } = result.data || {};
    console.log("🟢 Number of groups:", groups?.length || 0);

    // Map groups to include enriched levels
    const formattedData = groups.map((group) => {
      let parsedLevels = {};
      try {
        parsedLevels = typeof group.levels === "string" ? JSON.parse(group.levels) : group.levels || {};
      } catch (err) {
        console.error(`⚠️ Failed to parse levels for group ID ${group.id}`, err);
      }

      // Attach exercises to each level item
      Object.keys(parsedLevels).forEach((levelKey) => {
        const items = Array.isArray(parsedLevels[levelKey]) ? parsedLevels[levelKey] : [parsedLevels[levelKey]];
        parsedLevels[levelKey] = items.map((item) => ({
          ...item,
          sessionExercises: (item.sessionExerciseId || [])
            .map((id) => exerciseMap[id])
            .filter(Boolean),
        }));
      });

      return {
        id: group.id,
        groupName: group.groupName,
        type: group.type,
        pinned: group.pinned,
        player: group.player,
        banner: group.banner,
        createdBy: group.createdBy,
        createdAt: group.createdAt,
        updatedAt: group.updatedAt,
        levels: parsedLevels,
      };
    });

    console.log("🟢 Formatted data ready:", formattedData.length);

    return res.status(200).json({
      status: true,
      message: "Fetched session plan groups with exercises successfully.",
      data: formattedData,
    });
  } catch (error) {
    console.error("❌ Controller Error:", error);
    return res.status(500).json({
      status: false,
      message: "Server error occurred while fetching session plan groups.",
    });
  }
};

exports.downloadSessionPlanConfigVideo = async (req, res) => {
  const { id } = req.params;
  const { level } = req.query; // ?level=beginner
  const adminId = req.admin?.id;

  try {
    // STEP 1: Validate
    const validLevels = ["beginner", "intermediate", "advanced", "pro"];
    if (!level || !validLevels.includes(level)) {
      return res.status(400).json({
        status: false,
        message: `Invalid or missing level. Must be one of: ${validLevels.join(", ")}.`,
      });
    }

    const videoField = `${level}_video`; // e.g., beginner_video

    // STEP 2: Fetch group data
    const group = await SessionPlanGroup.findOne({
      where: { id, createdBy: adminId },
      attributes: ["id", "groupName", videoField],
    });

    if (!group) {
      return res.status(404).json({ status: false, message: "Session Plan Group not found." });
    }

    const videoUrl = group[videoField];
    if (!videoUrl) {
      return res.status(404).json({ status: false, message: `No ${level} video found.` });
    }

    // STEP 3: Fetch the video file
    const response = await fetch(videoUrl);
    if (!response.ok) {
      return res.status(500).json({ status: false, message: `Failed to fetch video: ${response.statusText}` });
    }

    // STEP 4: Convert to Node.js readable stream
    const nodeStream =
      typeof response.body.pipe === "function"
        ? response.body
        : Readable.fromWeb(response.body);

    // STEP 5: Set headers for download
    const safeName = group.groupName?.replace(/\s+/g, "_") || "session";
    const finalFileName = `${safeName}_${level}.mp4`;

    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Disposition", `attachment; filename="${finalFileName}"`);

    // STEP 6: Stream file
    nodeStream.pipe(res);
  } catch (error) {
    console.error("❌ Error downloading session plan group video:", error);
    return res.status(500).json({
      status: false,
      message: "Error downloading video.",
      error: error.message,
    });
  }
};

exports.updateSessionPlanConfig = async (req, res) => {
  const { id } = req.params;
  const { groupName, levels, player } = req.body;
  const adminId = req.admin?.id;
  const files = req.files || {};

  if (!adminId) {
    return res.status(401).json({ status: false, message: "Unauthorized: Admin ID not found." });
  }

  console.log("STEP 1: Received request", { id, groupName, levels, player, files: Object.keys(files) });

  try {
    // STEP 2: Fetch existing group
    const existingResult = await SessionPlanGroupService.getSessionPlanConfigById(id, adminId);
    if (!existingResult.status || !existingResult.data) {
      console.log("STEP 2: Session Plan Group not found");
      return res.status(404).json({ status: false, message: "Session Plan Group not found" });
    }
    const existing = existingResult.data;
    console.log("STEP 2: Existing group fetched:", existing);

    // STEP 3: Parse & merge levels
    let parsedLevels = existing.levels || {};
    if (levels) {
      parsedLevels = typeof levels === "string" ? JSON.parse(levels) : levels;
      parsedLevels = { ...existing.levels, ...parsedLevels };
    }
    console.log("STEP 3: Parsed levels:", parsedLevels);

    // STEP 4: Helper to save files
    const saveFileIfExists = async (file, type, oldUrl = null, level = null) => {
      if (!file) return oldUrl || null;

      const path = require("path");
      const fs = require("fs").promises;

      const uniqueId = Date.now() + "_" + Math.floor(Math.random() * 1e9);
      const ext = path.extname(file.originalname || "file");
      const fileName = uniqueId + ext;

      const localPath = path.join(
        process.cwd(),
        "uploads",
        "temp",
        "admin",
        `${adminId}`,
        "session-plan-group",
        `${id}`,
        type,
        level || "",
        fileName
      );

      await fs.mkdir(path.dirname(localPath), { recursive: true });
      await saveFile(file, localPath);

      let uploadedUrl = null;
      try {
        const relativeFtpPath = path.relative(path.join(process.cwd(), "uploads"), localPath).replace(/\\/g, "/");
        uploadedUrl = await uploadToFTP(localPath, relativeFtpPath);
      } catch (err) {
        console.error(`Failed to upload ${type}/${level || ""}`, err);
      } finally {
        await fs.unlink(localPath).catch(() => { });
      }

      return uploadedUrl || oldUrl;
    };

    // STEP 5: Flatten files
    const allFiles = Object.values(files).flat();
    console.log("STEP 5: All uploaded files:", allFiles.map(f => f.fieldname || f.originalname));

    // Banner
    const bannerFile = allFiles.find(
      f =>
        f.fieldname?.toLowerCase().includes("banner") ||
        f.originalname?.toLowerCase().includes("banner")
    );
    const banner = await saveFileIfExists(bannerFile, "banner", existing.banner);

    // STEP 6: Handle uploads + videos for each level
    const uploadFields = {};
    const uploadedFiles = {};
    (allFiles || []).forEach(f => {
      uploadedFiles[f.fieldname] = f; // If multiple files with same fieldname, take the last one
    });
    for (const level of ["beginner", "intermediate", "advanced", "pro"]) {
      // Upload
      let uploadFile = uploadedFiles[`${level}_upload`] || null;
      if (uploadFile) {
        uploadFields[`${level}_upload`] = await saveFileIfExists(
          uploadFile,
          "upload",
          existing[`${level}_upload`],
          level
        );
      } else {
        uploadFields[`${level}_upload`] = existing[`${level}_upload`] || null;
      }

      // Video
      let videoFile = uploadedFiles[`${level}_video`] || null;
      if (videoFile) {
        uploadFields[`${level}_video`] = await saveFileIfExists(
          videoFile,
          "video",
          existing[`${level}_video`],
          level
        );
      } else {
        uploadFields[`${level}_video`] = existing[`${level}_video`] || null;
      }

      console.log(`STEP 6: uploadFields[${level}_upload] =`, uploadFields[`${level}_upload`]);
      console.log(`STEP 6: uploadFields[${level}_video] =`, uploadFields[`${level}_video`]);
    }

    // Parse existing images
    let existingImages = Array.isArray(existing.images) ? existing.images : [];
    if (typeof existingImages === "string") {
      try { existingImages = JSON.parse(existingImages); }
      catch (e) { existingImages = []; }
    }

    // Collect new images from req.body (URLs)
    let newImages = [];
    if (req.body.images) {
      const bodyImages = Array.isArray(req.body.images) ? req.body.images : [req.body.images];
      newImages.push(...bodyImages);
    }

    // Collect new images from uploaded files (binary)
    if (files.images) {
      const fileImages = Array.isArray(files.images) ? files.images : [files.images];
      for (const file of fileImages) {
        const uploadedUrl = await saveFileIfExists(file, "sessionExercise", null);
        if (uploadedUrl) newImages.push(uploadedUrl);
      }
    }

    // Merge old + new images
    const finalImages = [...existingImages, ...newImages];

    // Update payload (store as array if JSON column, or stringify if TEXT)
    const updatePayload = {
      groupName: groupName?.trim() || existing.groupName,
      levels: parsedLevels,
      player: player || existing.player,
      banner,
      ...uploadFields,
      images: finalImages
    };
    console.log("STEP 7: updatePayload =", updatePayload);

    // STEP 8: Update DB
    const updateResult = await SessionPlanGroupService.updateSessionPlanConfig(id, updatePayload, adminId);
    if (!updateResult.status) {
      console.log("STEP 8: DB update failed");
      return res.status(500).json({ status: false, message: "Update failed." });
    }
    const updated = updateResult.data;

    // STEP 9: Response
    const responseData = {
      id: updated.id,
      groupName: updated.groupName,
      player: updated.player,
      banner: updated.banner,
      levels: typeof updated.levels === "string" ? JSON.parse(updated.levels) : updated.levels,
      beginner_upload: updated.beginner_upload,
      intermediate_upload: updated.intermediate_upload,
      advanced_upload: updated.advanced_upload,
      pro_upload: updated.pro_upload,
      beginner_video: updated.beginner_video,
      intermediate_video: updated.intermediate_video,
      advanced_video: updated.advanced_video,
      pro_video: updated.pro_video,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };

    console.log("STEP 9: Final responseData =", responseData);
    // STEP 9: Log and notify
    await logActivity(
      req,
      "Admin Panel", // PANEL name
      "Session Plan Group", // MODULE name
      "update", // Action type
      {
        oneLineMessage: `Session Plan Group '${updatePayload.groupName}' updated by ${req?.admin?.firstName || "Admin"}.`
      },
      true
    );

    await createNotification(
      req,
      "Session Plan Group Updated",
      `The session plan group '${updatePayload.groupName}' (ID: ${id}) was updated by ${req?.admin?.firstName || "Admin"}.`,
      "System"
    );

    return res.status(200).json({
      status: true,
      message: "Session Plan Group updated successfully.",
      data: responseData,
    });
  } catch (error) {
    console.error("STEP 10: Update error:", error);
    return res.status(500).json({ status: false, message: "Failed to update Session Plan Group." });
  }
};

exports.deleteSessionPlanConfig = async (req, res) => {
  const { id } = req.params;
  const adminId = req.admin?.id; // ✅ track who deleted

  if (DEBUG) console.log(`🗑️ Deleting Session Plan Group ID: ${id}`);

  try {
    // ✅ Check if group exists
    const existingResult = await SessionPlanGroupService.getSessionPlanConfigById(id, adminId);

    if (!existingResult.status || !existingResult.data) {
      await logActivity(
        req,
        PANEL,
        MODULE,
        "delete",
        { oneLineMessage: `Delete failed - Group ID ${id} not found` },
        false
      );
      return res.status(404).json({
        status: false,
        message: existingResult.message || "Session Plan Group not found.",
      });
    }

    const existing = existingResult.data;

    // ✅ Soft delete the group
    const deleteResult = await SessionPlanGroupService.deleteSessionPlanConfig(
      id,
      adminId
    );

    if (!deleteResult.status) {
      await logActivity(
        req,
        PANEL,
        MODULE,
        "delete",
        { oneLineMessage: `Delete failed for Group ID ${id}` },
        false
      );
      return res.status(400).json({
        status: false,
        message: deleteResult.message || "Failed to delete Session Plan Group.",
      });
    }

    // ✅ Remove uploaded files if needed (optional)
    const filePaths = [existing.banner, existing.video].filter(Boolean);
    for (const filePath of filePaths) {
      try {
        await deleteFile(filePath);
        if (DEBUG) console.log(`🗑️ Deleted associated file: ${filePath}`);
      } catch (err) {
        console.error(`⚠️ Failed to delete file ${filePath}:`, err.message);
      }
    }

    await logActivity(
      req,
      PANEL,
      MODULE,
      "delete",
      { oneLineMessage: `Deleted Session Plan Group ID: ${id}` },
      true
    );

    return res.status(200).json({
      status: true,
      message: "Session Plan Group deleted successfully.",
      data: { id },
    });
  } catch (error) {
    console.error("❌ Error during Session Plan Group deletion:", error);
    await logActivity(
      req,
      PANEL,
      MODULE,
      "delete",
      { oneLineMessage: error.message },
      false
    );
    return res.status(500).json({
      status: false,
      message: "Server error occurred while deleting Session Plan Group.",
    });
  }
};

//Delete by level data
exports.deleteSessionPlanConfigLevel = async (req, res) => {
  const { id, levelKey } = req.params;
  const adminId = req.admin?.id; // ✅

  console.log("============================================");
  console.log("📌 CONTROLLER: deleteSessionPlanGroupLevel");
  console.log("📌 Incoming Params:", { id, levelKey });
  console.log("➡️ Calling service.deleteLevelFromSessionPlanGroup...");

  try {
    const result =
      await SessionPlanGroupService.deleteLevelFromSessionPlanConfig(
        id,
        levelKey,
        adminId // ✅ pass createdBy
      );

    console.log("⬅️ Service returned:", result);

    if (!result.status) {
      return res.status(404).json({
        status: false,
        message: result.message || `Failed to delete '${levelKey}'`,
      });
    }

    await logActivity(
      req,
      PANEL,
      MODULE,
      "delete-level",
      { oneLineMessage: `Deleted level '${levelKey}' for group ID: ${id}` },
      true
    );

    await createNotification(
      req,
      "Session Plan Level Deleted",
      `Level '${levelKey}' from Session Plan Group ID ${id} was deleted by ${req?.admin?.firstName || "Admin"
      }.`,
      "System"
    );

    return res.status(200).json({
      status: true,
      message: result.message,
      data: result.data,
    });
  } catch (error) {
    console.error("❌ CONTROLLER delete level error:", error);

    await logActivity(
      req,
      PANEL,
      MODULE,
      "delete-level",
      { oneLineMessage: error.message },
      false
    );

    return res.status(500).json({
      status: false,
      message: "Failed to delete level. Please try again later.",
    });
  }
};

exports.repinSessionPlanGroup = async (req, res) => {
  try {
    const createdBy = req.admin?.id || req.user?.id;
    const { id } = req.params;          // e.g. PATCH /api/session-plans/130/repin
    const { pinned } = req.body;        // e.g. { "pinned": 1 }

    // 🔹 Validate required parameters
    if (!id) {
      return res.status(400).json({
        status: false,
        message: "Missing required parameter: id",
      });
    }

    if (!createdBy) {
      return res.status(400).json({
        status: false,
        message: "Missing creator information (createdBy).",
      });
    }

    const pinnedValue = Number(pinned);
    if (![0, 1].includes(pinnedValue)) {
      return res.status(400).json({
        status: false,
        message: "Invalid or missing pinned value (should be 0 or 1).",
      });
    }

    // 🔸 Delegate to service
    const result = await SessionPlanGroupService.repinSessionPlanGroupService(
      id,
      createdBy,
      pinnedValue
    );

    // 🔸 If operation failed, log & return error
    if (!result.status) {
      await logActivity(req, PANEL, MODULE, "repin", result, false);
      return res.status(400).json({
        status: false,
        message: result.message || "Failed to repin session plan group.",
      });
    }

    // ✅ Create a notification
    const action = pinnedValue === 1 ? "pinned" : "unpinned";
    await createNotification({
      userId: createdBy,
      title: `Session Plan ${action}`,
      message: `You have ${action} session plan group (ID: ${id}).`,
      type: "session_plan",
      metadata: {
        groupId: id,
        pinned: pinnedValue,
      },
    });

    // ✅ Log activity
    await logActivity(req, PANEL, MODULE, "repin", result, true);

    return res.status(200).json({
      ...result,
      notification: `Notification created for ${action} group.`,
    });
  } catch (error) {
    console.error("❌ Controller Error (repinSessionPlanGroup):", error);

    await logActivity(
      req,
      PANEL,
      MODULE,
      "repin",
      { message: error.message },
      false
    );

    return res.status(500).json({
      status: false,
      message: "Server error while repinning session plan group.",
    });
  }
};

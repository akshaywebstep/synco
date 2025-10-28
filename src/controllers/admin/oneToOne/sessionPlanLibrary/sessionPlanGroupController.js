const { validateFormData } = require("../../../../utils/validateFormData");
const SessionPlanGroupService = require("../../../../services/admin/oneToOne/sessionPlanLibrary/sessionPlanGroup");
const SessionExerciseService = require("../../../../services/admin/oneToOne/sessionPlanLibrary/sessionExercise");

const { logActivity } = require("../../../../utils/admin/activityLogger");
const { downloadFromFTP, uploadToFTP } = require("../../../../utils/uploadToFTP");

const { getVideoDurationInSeconds, formatDuration, } = require("../../../../utils/videoHelper");
const {
  createNotification,
} = require("../../../../utils/admin/notificationHelper");
const { SessionExercise, SessionPlanConfig } = require("../../../../models");
const path = require("path");
const { saveFile, deleteFile } = require("../../../../utils/fileHandler");

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

    // ===============================
    // STEP 4: Create DB entry (no update)
    // ===============================
    const payload = {
      groupName,
      levels: parsedLevels,
      player,
      createdBy,
      banner,
      ...uploadFields,
    };

    const result = await SessionPlanGroupService.createSessionPlanGroup(payload);

    if (!result.status)
      return res.status(400).json({
        status: false,
        message:
          result.message || "Failed to create session plan group.",
      });

    const sessionPlanId = result.data.id;

    // ✅ Create entry in SessionPlanConfig
    const { SessionPlanConfig } = require("../../../../models");
    try {
      await SessionPlanConfig.create({
        sessionPlanGroupId: sessionPlanId,
        type: "one_to_one", 
        createdBy,
        pinned: 1,
      });
    } catch (err) {
      console.error("Failed to create SessionPlanConfig:", err.message);
    }

    // ===============================
    // STEP 5: Response
    // ===============================
    const responseData = {
      id: sessionPlanId,
      groupName: result.data.groupName,
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

exports.getSessionPlanGroupStructureById = async (req, res) => {
  try {
    const { id } = req.params; // ✔ use `id` instead of configId
    const createdBy = req.admin?.id || req.user?.id;

    if (!id) {
      return res.status(400).json({
        status: false,
        message: "Session Plan Group ID is required.",
      });
    }

    // Now you can safely call your service
    const result = await SessionPlanGroupService.getSessionPlanConfigById(id, createdBy);

    if (!result.status) {
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
      parsedLevels = {};
      console.error("Failed to parse levels:", err);
    }

    // … rest of your code (exercise enrichment, video info, etc.)
    
    return res.status(200).json({
      status: true,
      message: "Fetched session plan group successfully.",
      data: {
        ...group,
        // levels: parsedLevels,
      },
    });
  } catch (error) {
    console.error("Error in getSessionPlanGroupStructureById:", error);
    return res.status(500).json({ status: false, message: "Server error." });
  }
};

exports.getAllSessionPlanGroupStructure = async (req, res) => {
  try {
    const createdBy = req.admin?.id || req.user?.id;
    console.log("🟢 createdBy:", createdBy);

    const result = await SessionPlanGroupService.getAllSessionPlanConfig({ createdBy });
    if (!result.status) {
      console.error("❌ Service returned an error:", result.message);
      return res.status(500).json({ status: false, message: result.message });
    }

    const { configs, groups, exerciseMap } = result.data;
    console.log("🟢 Number of configs:", configs.length);

    // Map configs to include their group and enrich levels with exercises
    const formattedData = configs.map((config) => {
      const group = groups.find(g => g.id === config.sessionPlanGroupId);
      if (!group) return null; // Skip if group not found

      let parsedLevels = {};
      try {
        parsedLevels = typeof group.levels === "string" ? JSON.parse(group.levels) : group.levels || {};
      } catch (err) {
        console.error(`⚠️ Failed to parse levels for group ID ${group.id}`, err);
      }

      // Attach exercises to each level item
      Object.keys(parsedLevels).forEach(levelKey => {
        const items = Array.isArray(parsedLevels[levelKey]) ? parsedLevels[levelKey] : [parsedLevels[levelKey]];
        parsedLevels[levelKey] = items.map(item => ({
          ...item,
          sessionExercises: (item.sessionExerciseId || []).map(id => exerciseMap[id]).filter(Boolean),
        }));
      });

      return {
        id: config.id,
        type: config.type,
        pinned: config.pinned,
        createdBy: config.createdBy,
        createdAt: config.createdAt,
        updatedAt: config.updatedAt,
        group: {
          ...group,
          levels: parsedLevels,
        },
      };
    }).filter(Boolean); // Remove nulls if any config's group not found

    console.log("🟢 Formatted data ready:", formattedData.length);

    return res.status(200).json({
      status: true,
      message: "Fetched session plan groups with exercises successfully.",
      data: formattedData,
    });

  } catch (error) {
    console.error("❌ Controller Error:", error);
    return res.status(500).json({ status: false, message: "Server error." });
  }
};

exports.updateSessionPlanGroup = async (req, res) => {
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
    const updateResult = await SessionPlanGroupService.updateSessionPlanGroup(id, updatePayload, adminId);
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

// exports.getSessionPlanGroupStructureById = async (req, res) => {
//   try {
//     const createdBy = req.admin?.id || req.user?.id;
//     const { id } = req.params;

//     if (!id) {
//       return res.status(400).json({
//         status: false,
//         message: "Missing required parameter: id",
//       });
//     }

//     const result = await SessionPlanGroupService.getSessionPlanGroupById(id, createdBy);

//     if (!result.status) {
//       return res.status(404).json(result);
//     }

//     return res.status(200).json(result);
//   } catch (error) {
//     console.error("❌ Controller Error (getSessionPlanGroupById):", error);
//     return res.status(500).json({
//       status: false,
//       message: "Server error while fetching session plan group.",
//     });
//   }
// };

exports.repinSessionPlanGroup = async (req, res) => {
  try {
    const createdBy = req.admin?.id || req.user?.id;
    const { id } = req.params; // e.g. /130/repin
    const { pinned } = req.body; // from payload

    if (!id) {
      return res.status(400).json({ status: false, message: "Missing required parameter: id" });
    }

    if (!createdBy) {
      return res.status(400).json({ status: false, message: "Missing creator information (createdBy)." });
    }

    if (pinned === undefined || ![0, 1].includes(Number(pinned))) {
      return res.status(400).json({ status: false, message: "Invalid or missing pinned value (should be 0 or 1)." });
    }

    // 🔸 Delegate to service
    const result = await SessionPlanGroupService.repinSessionPlanGroup(id, createdBy, Number(pinned));

    // 🔸 Handle response
    if (!result.status) {
      await logActivity(req, PANEL, MODULE, "repin", result, false);
      return res.status(400).json({ status: false, message: result.message });
    }

    await logActivity(req, PANEL, MODULE, "repin", result, true);
    return res.status(200).json(result);
  } catch (error) {
    console.error("❌ Controller Error (repinSessionPlanGroup):", error);
    await logActivity(req, PANEL, MODULE, "repin", { message: error.message }, false);
    return res.status(500).json({ status: false, message: "Server error while repinning session plan group." });
  }
};

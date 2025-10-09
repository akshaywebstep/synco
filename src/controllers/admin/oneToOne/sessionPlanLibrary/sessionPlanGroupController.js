const { validateFormData } = require("../../../../utils/validateFormData");
const SessionPlanGroupService = require("../../../../services/admin/oneToOne/sessionPlanLibrary/sessionPlanGroup");
const SessionExerciseService = require("../../../../services/admin/oneToOne/sessionPlanLibrary/sessionExercise");

const { logActivity } = require("../../../../utils/admin/activityLogger");
const { downloadFromFTP, uploadToFTP } = require("../../../../utils/uploadToFTP");

const { getVideoDurationInSeconds, formatDuration, } = require("../../../../utils/videoHelper");
const {
  createNotification,
} = require("../../../../utils/admin/notificationHelper");
const { SessionExercise } = require("../../../../models");
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
    if (DEBUG) console.log("📥 Received request to create session plan group");

    const formData = req.body;
    const createdBy = req.admin?.id || req.user?.id;

    if (!createdBy) {
      if (DEBUG) console.warn("❌ Unauthorized request");
      return res.status(403).json({ status: false, message: "Unauthorized request" });
    }

    const { groupName, levels, player } = formData;
    if (DEBUG) console.log("🔍 Validating required fields...");

    const validation = validateFormData(formData, {
      requiredFields: ["groupName", "player", "levels"],
    });
    if (!validation.isValid) {
      const firstErrorMsg = Object.values(validation.error)[0];
      if (DEBUG) console.warn("❌ Validation failed:", firstErrorMsg);
      return res.status(400).json({ status: false, message: firstErrorMsg });
    }

    if (DEBUG) console.log("📄 Parsing levels JSON...");
    let parsedLevels;
    try {
      parsedLevels = typeof levels === "string" ? JSON.parse(levels) : levels;
    } catch {
      if (DEBUG) console.warn("❌ Invalid JSON for levels");
      return res.status(400).json({ status: false, message: "Invalid JSON for levels" });
    }

    const levelError = validateLevels(parsedLevels);
    if (levelError) {
      if (DEBUG) console.warn("❌ Levels validation failed:", levelError);
      return res.status(400).json({ status: false, message: levelError });
    }

    if (DEBUG) console.log("🚀 Creating session plan group DB row...");
    const payloadWithoutFiles = { groupName, levels: parsedLevels, player, createdBy };
    const result = await SessionPlanGroupService.createSessionPlanGroup(payloadWithoutFiles);

    if (!result.status) {
      if (DEBUG) console.error("❌ Failed to create session plan group:", result.message);
      return res.status(400).json({ status: false, message: result.message || "Failed to create session plan group." });
    }

    const sessionPlanId = result.data.id;
    if (DEBUG) console.log("✅ Session Plan Group created with ID:", sessionPlanId);

    // Save sessionPlanId in SessionPlanConfig with fixed type "one to one"
    const { SessionPlanConfig } = require("../../../../models");
    if (DEBUG) console.log("💾 Saving sessionPlanId in SessionPlanConfig...");
    await SessionPlanConfig.create({
      sessionPlanGroupId: sessionPlanId,
      type: "one to one",
      createdBy,
    });

    // Handle file uploads
    const baseUploadDir = path.join(process.cwd(), "uploads", "temp", "admin", `${createdBy}`, "session-plan-group", `${sessionPlanId}`);
    let filesMap = Array.isArray(req.files) ? req.files.reduce((acc, f) => {
      acc[f.fieldname] = acc[f.fieldname] || [];
      acc[f.fieldname].push(f);
      return acc;
    }, {}) : (req.files || {});

    const saveAndUploadFile = async (file, type) => {
      if (DEBUG) console.log(`📤 Saving and uploading file for type: ${type}`);
      const uniqueId = Math.floor(Math.random() * 1e9);
      const ext = path.extname(file.originalname).toLowerCase();
      const fileName = `${Date.now()}_${uniqueId}${ext}`;
      const localPath = path.join(baseUploadDir, type, fileName);
      await fs.promises.mkdir(path.dirname(localPath), { recursive: true });
      if (file.buffer) await fs.promises.writeFile(localPath, file.buffer);
      else await saveFile(file, localPath);

      const relativeFtpPath = path.relative(path.join(process.cwd(), "uploads"), localPath).replace(/\\/g, "/");
      let uploadedPath = null;
      try { uploadedPath = await uploadToFTP(localPath, relativeFtpPath); } catch (err) { if (DEBUG) console.error(err.message); }
      finally { await fs.promises.unlink(localPath).catch(() => { }); }
      return uploadedPath;
    };

    const banner = filesMap.banner?.[0] ? await saveAndUploadFile(filesMap.banner[0], "banner") : null;

    const attachUploadsAndVideos = async (levelsObj) => {
      const uploadFields = {};
      for (const level of ["beginner", "intermediate", "advanced", "pro"]) {
        if (DEBUG) console.log(`📤 Processing uploads/videos for level: ${level}`);
        const fileArr = filesMap[`${level}_upload`];
        uploadFields[`${level}_upload`] = fileArr?.[0] ? await saveAndUploadFile(fileArr[0], path.join("upload", level)) : null;
        const videoArr = filesMap[`${level}_video`];
        uploadFields[`${level}_video`] = videoArr?.[0] ? await saveAndUploadFile(videoArr[0], path.join("video", level)) : null;
      }
      return { levelsObj, uploadFields };
    };

    const { levelsObj: levelsWithFiles, uploadFields } = await attachUploadsAndVideos(parsedLevels);

    if (DEBUG) console.log("💾 Updating session plan group with files...");
    const updatePayload = { banner, ...uploadFields };
    await SessionPlanGroupService.updateSessionPlanGroup(sessionPlanId, updatePayload, createdBy);

    if (DEBUG) console.log("📝 Logging activity...");
    await logActivity(req, PANEL, MODULE, "create", { sessionPlanId, groupName }, true);

    if (DEBUG) console.log("🔔 Sending notification...");
    await createNotification(
      req,
      "New Session Plan Group Created",
      `Session Plan Group "${groupName}" has been created successfully.`,
      "System"
    );

    if (DEBUG) console.log("✅ Sending response to client...");
    const responseData = {
      id: sessionPlanId,
      groupName: result.data.groupName,
      player: result.data.player,
      sortOrder: result.data.sortOrder || 0,
      createdAt: result.data.createdAt,
      updatedAt: result.data.updatedAt,
      banner,
      beginner_upload: updatePayload.beginner_upload,
      intermediate_upload: updatePayload.intermediate_upload,
      advanced_upload: updatePayload.advanced_upload,
      pro_upload: updatePayload.pro_upload,
      beginner_video: updatePayload.beginner_video,
      intermediate_video: updatePayload.intermediate_video,
      advanced_video: updatePayload.advanced_video,
      pro_video: updatePayload.pro_video,
      levels: levelsWithFiles,
    };

    return res.status(201).json({
      status: true,
      message: "Session Plan Group created successfully.",
      data: responseData,
    });
  } catch (error) {
    if (DEBUG) console.error("❌ Server error in createSessionPlanGroup:", error);
    return res.status(500).json({
      status: false,
      message: "Server error occurred while creating the session plan group.",
    });
  }
};

exports.getSessionPlanGroupStructureById = async (req, res) => {
  try {
    const { id } = req.params;
    const createdBy = req.admin?.id || req.user?.id;

    if (DEBUG)
      console.log("Fetching session plan group id:", id, "user:", createdBy);

    const result = await SessionPlanGroupService.getSessionPlanGroupById(id, createdBy);

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
    const { orderBy = "sortOrder", order = "ASC" } = req.query;

    const result = await SessionPlanGroupService.getAllSessionPlanGroups({
      orderBy,
      order,
      createdBy,
    });

    if (!result.status) {
      await logActivity(req, PANEL, MODULE, "list", result, false);
      return res.status(500).json({ status: false, message: result.message });
    }

    const { groups, exerciseMap } = result.data;

    const formattedData = groups.map((group) => {
      let parsedLevels = {};
      try {
        parsedLevels =
          typeof group.levels === "string"
            ? JSON.parse(group.levels)
            : group.levels || {};
      } catch {
        parsedLevels = {};
      }

      Object.keys(parsedLevels).forEach((levelKey) => {
        const items = Array.isArray(parsedLevels[levelKey])
          ? parsedLevels[levelKey]
          : [parsedLevels[levelKey]];

        parsedLevels[levelKey] = items.map((item) => ({
          ...item,
          sessionExercises: (item.sessionExerciseId || [])
            .map((id) => exerciseMap[id])
            .filter(Boolean),
        }));
      });

      return {
        ...group,
        levels: parsedLevels,
      };
    });

    await logActivity(
      req,
      PANEL,
      MODULE,
      "list",
      { count: formattedData.length },
      true
    );

    return res.status(200).json({
      status: true,
      message: "Fetched session plan groups with exercises successfully.",
      data: formattedData,
    });
  } catch (error) {
    console.error("❌ Controller Error:", error);
    return res.status(500).json({ status: false, message: "Server error" });
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

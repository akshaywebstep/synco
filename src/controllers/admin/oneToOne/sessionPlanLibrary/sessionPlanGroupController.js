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
        type: "one_to_one", // dynamic type if needed later
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
    const { orderBy = "sortOrder", order = "ASC" } = req.query;

    const result = await SessionPlanGroupService.getAllSessionPlanConfig({ orderBy, order, createdBy });
    if (!result.status) return res.status(500).json({ status: false, message: result.message });

    const { groups, exerciseMap } = result.data;

    // Enrich levels with exercises
    const formattedData = groups.map(group => {
      let parsedLevels = {};
      try {
        parsedLevels = typeof group.levels === "string" ? JSON.parse(group.levels) : group.levels || {};
      } catch { parsedLevels = {}; }

      Object.keys(parsedLevels).forEach(levelKey => {
        const items = Array.isArray(parsedLevels[levelKey]) ? parsedLevels[levelKey] : [parsedLevels[levelKey]];
        parsedLevels[levelKey] = items.map(item => ({
          ...item,
          sessionExercises: (item.sessionExerciseId || []).map(id => exerciseMap[id]).filter(Boolean),
        }));
      });

      return { ...group, levels: parsedLevels };
    });

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

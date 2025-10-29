const { validateFormData } = require("../../../utils/validateFormData");
const SessionPlanGroupService = require("../../../services/admin/sessionPlan/sessionPlanGroup");
const SessionExerciseService = require("../../../services/admin/sessionPlan/sessionExercise");
const { logActivity } = require("../../../utils/admin/activityLogger");
// const { getVideoDurationInSeconds } = require("../../../utils/videoHelper");
const { downloadFromFTP, uploadToFTP } = require("../../../utils/uploadToFTP");
const { Readable } = require("stream");

const { getVideoDurationInSeconds, formatDuration, } = require("../../../utils/videoHelper");
const {
  createNotification,
} = require("../../../utils/admin/notificationHelper");
const { SessionExercise, SessionPlanGroup } = require("../../../models");
const path = require("path");
const { saveFile, deleteFile } = require("../../../utils/fileHandler");

const fs = require("fs");
const os = require("os");
const { getMainSuperAdminOfAdmin } = require("../../../utils/auth");

const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "session-plan-group";

// const saveFileAsNew = async (oldUrl, createdBy, newGroupId, typeFolder) => {
//   if (!oldUrl) return null;

//   const fileName = path.basename(oldUrl);
//   const localTempPath = path.join(os.tmpdir(), fileName);

//   // Download old file
//   console.log("⬇️ Downloading old file:", oldUrl);
//   await downloadFromFTP(oldUrl, localTempPath);

//   // Remote folder path
//   const remoteDir = path.posix.join(
//     "temp",
//     "admin",
//     `${createdBy}`,
//     "session-plan-group",
//     `${newGroupId}`,
//     typeFolder
//   );

//   // Ensure local temp folder exists
//   await fs.promises.mkdir(path.dirname(localTempPath), { recursive: true });

//   // New unique file name
//   const uniqueId = Math.floor(Math.random() * 1e9);
//   const ext = path.extname(fileName);
//   const newFileName = `${Date.now()}_${uniqueId}${ext}`;
//   const remoteFilePath = path.posix.join(remoteDir, newFileName);

//   try {
//     // Upload file (remote directories are auto-created in uploadToFTP)
//     const publicUrl = await uploadToFTP(localTempPath, remoteFilePath);

//     return publicUrl;
//   } catch (err) {
//     console.error("❌ FTP upload failed:", err);
//     return null;
//   } finally {
//     // Cleanup local temp file
//     await fs.promises.unlink(localTempPath).catch(() => { });
//   }
// };

// exports.duplicateSessionPlanGroup = async (req, res) => {
//   try {
//     const { id } = req.params; // old group ID
//     const createdBy = req.admin?.id || req.user?.id;
//     if (!createdBy) return res.status(403).json({ status: false, message: "Unauthorized request" });

//     // Duplicate DB row without handling files yet
//     const result = await SessionPlanGroupService.duplicateSessionPlanGroup(id, createdBy);
//     if (!result.status) return res.status(404).json({ status: false, message: result.message });

//     const group = result.data; // new group DB row
//     const newGroupId = group.id;

//     // STEP 1: Save banner & video as new files (like create function)
//     const banner = await saveFileAsNew(group.banner, createdBy, newGroupId, "banner");
//     const video = await saveFileAsNew(group.video, createdBy, newGroupId, "video");

//     // STEP 2: Save recordings as new files
//     const uploadFields = {};
//     for (const level of ["beginner", "intermediate", "advanced", "pro"]) {
//       uploadFields[`${level}_upload`] = await saveFileAsNew(
//         group[`${level}_upload`],
//         createdBy,
//         newGroupId,
//         path.posix.join("upload", level)
//       );
//     }

//     // STEP 3: Update DB row with new file URLs
//     await SessionPlanGroupService.updateSessionPlanGroup(newGroupId, { banner, video, ...uploadFields }, createdBy);

//     // STEP 4: Build response
//     const responseData = {
//       id: group.id,
//       groupName: group.groupName,
//       player: group.player,
//       sortOrder: group.sortOrder || 0,
//       createdAt: group.createdAt,
//       updatedAt: group.updatedAt,
//       banner,
//       video,
//       beginner_upload: uploadFields.beginner_upload,
//       intermediate_upload: uploadFields.intermediate_upload,
//       advanced_upload: uploadFields.advanced_upload,
//       pro_upload: uploadFields.pro_upload,
//       levels: group.levels,
//     };

//     return res.status(201).json({
//       status: true,
//       message: "Session Plan Group duplicated successfully.",
//       data: responseData,
//     });

//   } catch (error) {
//     if (DEBUG) console.error("Error in duplicateSessionPlanGroup:", error);
//     return res.status(500).json({ status: false, message: "Server error." });
//   }
// };

// exports.createSessionPlanGroup = async (req, res) => {
//   try {
//     const formData = req.body;
//     const createdBy = req.admin?.id || req.user?.id;

//     // Normalize req.files
//     let filesMap = {};
//     if (Array.isArray(req.files)) {
//       filesMap = req.files.reduce((acc, f) => {
//         acc[f.fieldname] = acc[f.fieldname] || [];
//         acc[f.fieldname].push(f);
//         return acc;
//       }, {});
//     } else {
//       filesMap = req.files || {};
//     }

//     if (!createdBy) return res.status(403).json({ status: false, message: "Unauthorized request" });

//     const { groupName, levels, player } = formData;

//     // Validate required fields
//     const validation = validateFormData(formData, {
//       requiredFields: ["groupName", "player", "levels"],
//     });

//     if (!validation.isValid) {
//       const firstErrorMsg = Object.values(validation.error)[0];
//       return res.status(400).json({ status: false, message: firstErrorMsg });
//     }

//     // Parse levels JSON
//     let parsedLevels;
//     try {
//       parsedLevels = typeof levels === "string" ? JSON.parse(levels) : levels;
//     } catch {
//       return res.status(400).json({ status: false, message: "Invalid JSON for levels" });
//     }

//     // Validate levels
//     const levelError = validateLevels(parsedLevels);
//     if (levelError) return res.status(400).json({ status: false, message: levelError });

//     // STEP 1: Create DB row without banner/video first
//     const payloadWithoutFiles = { groupName, levels: parsedLevels, player, createdBy };
//     const result = await SessionPlanGroupService.createSessionPlanGroup(payloadWithoutFiles);

//     if (!result.status) return res.status(400).json({ status: false, message: result.message || "Failed to create session plan group." });

//     const sessionPlanId = result.data.id; // ✅ DB-generated ID
//     const baseUploadDir = path.join(
//       process.cwd(),
//       "uploads",
//       "temp",
//       "admin",
//       `${createdBy}`,
//       "session-plan-group",
//       `${sessionPlanId}`
//     );

//     // Helper to save & upload files
//     const saveAndUploadFile = async (file, type) => {
//       const uniqueId = Math.floor(Math.random() * 1e9);
//       const ext = path.extname(file.originalname).toLowerCase();
//       const fileName = `${Date.now()}_${uniqueId}${ext}`;

//       // Local path
//       const localPath = path.join(baseUploadDir, type, fileName);
//       await fs.promises.mkdir(path.dirname(localPath), { recursive: true });

//       if (file.buffer) {
//         await fs.promises.writeFile(localPath, file.buffer);
//       } else {
//         await saveFile(file, localPath);
//       }

//       // FTP path should include the same folder structure as localPath relative to baseUploadDir
//       const relativeFtpPath = path.relative(path.join(process.cwd(), "uploads"), localPath).replace(/\\/g, "/");
//       // This will give: temp/admin/2/session-plan-group/46/banner/filename.ext

//       let uploadedPath = null;
//       try {
//         uploadedPath = await uploadToFTP(localPath, relativeFtpPath); // <-- pass full relative path
//       } catch (err) {
//         console.error(`Failed to upload ${type}:`, err.message);
//       } finally {
//         await fs.promises.unlink(localPath).catch(() => { });
//       }

//       return uploadedPath;
//     };

//     // STEP 2: Upload banner & video
//     const banner = filesMap.banner?.[0] ? await saveAndUploadFile(filesMap.banner[0], "banner") : null;
//     const video = filesMap.video?.[0] ? await saveAndUploadFile(filesMap.video[0], "video") : null;

//     // STEP 3: Upload recordings with proper path
//     const attachUploadToLevels = async (levelsObj) => {
//       const uploadFields = {};
//       for (const level of ["beginner", "intermediate", "advanced", "pro"]) {
//         const fileArr = filesMap[`${level}_upload`];
//         let uploadedUpload = null;
//         if (fileArr && fileArr[0]) {
//           uploadedUpload = await saveAndUploadFile(fileArr[0], path.join("upload", level));
//         }
//         uploadFields[`${level}_upload`] = uploadedUpload;
//       }
//       return { levelsObj, uploadFields };
//     };

//     const { levelsObj: levelsWithUploads, uploadFields } = await attachUploadToLevels(parsedLevels);

//     // STEP 4: Update DB row with banner, video, and recordings
//     const updatePayload = { banner, video, ...uploadFields };
//     await SessionPlanGroupService.updateSessionPlanGroup(sessionPlanId, updatePayload, createdBy);

//     // STEP 5: Build response
//     const responseData = {
//       id: sessionPlanId,
//       groupName: result.data.groupName,
//       player: result.data.player,
//       sortOrder: result.data.sortOrder || 0,
//       createdAt: result.data.createdAt,
//       updatedAt: result.data.updatedAt,
//       banner,
//       video,
//       beginner_upload: updatePayload.beginner_upload,
//       intermediate_upload: updatePayload.intermediate_upload,
//       advanced_upload: updatePayload.advanced_upload,
//       pro_upload: updatePayload.pro_upload,
//       levels: levelsWithUploads,
//     };

//     return res.status(201).json({ status: true, message: "Session Plan Group created successfully.", data: responseData });

//   } catch (error) {
//     console.error("Server error in createSessionPlanGroup:", error);
//     return res.status(500).json({ status: false, message: "Server error occurred while creating the session plan group." });
//   }
// };

const saveFileAsNew = async (oldUrl, createdBy, newGroupId, typeFolder) => {
  if (!oldUrl) return null;

  const fileName = path.basename(oldUrl);
  const localTempPath = path.join(os.tmpdir(), fileName);

  // Download old file
  console.log("⬇️ Downloading old file:", oldUrl);
  await downloadFromFTP(oldUrl, localTempPath);

  // Remote folder path
  const remoteDir = path.posix.join(
    "temp",
    "admin",
    `${createdBy}`,
    "session-plan-group",
    `${newGroupId}`,
    typeFolder
  );

  // Ensure local temp folder exists
  await fs.promises.mkdir(path.dirname(localTempPath), { recursive: true });

  // New unique file name
  const uniqueId = Math.floor(Math.random() * 1e9);
  const ext = path.extname(fileName);
  const newFileName = `${Date.now()}_${uniqueId}${ext}`;
  const remoteFilePath = path.posix.join(remoteDir, newFileName);

  try {
    const publicUrl = await uploadToFTP(localTempPath, remoteFilePath);
    return publicUrl;
  } catch (err) {
    console.error("❌ FTP upload failed:", err);
    return null;
  } finally {
    await fs.promises.unlink(localTempPath).catch(() => { });
  }
};

exports.duplicateSessionPlanGroup = async (req, res) => {
  try {
    const { id } = req.params; // old group ID
    const createdBy = req.admin?.id || req.user?.id;
    if (!createdBy) return res.status(403).json({ status: false, message: "Unauthorized request" });

    // Duplicate DB row without handling files yet
    const result = await SessionPlanGroupService.duplicateSessionPlanGroup(id, createdBy);
    if (!result.status) return res.status(404).json({ status: false, message: result.message });

    const group = result.data; // new group DB row
    const newGroupId = group.id;

    // STEP 1: Save banner
    const banner = await saveFileAsNew(group.banner, createdBy, newGroupId, "banner");

    // STEP 2: Save per-level uploads + videos
    const uploadFields = {};
    for (const level of ["beginner", "intermediate", "advanced", "pro"]) {
      // Upload
      uploadFields[`${level}_upload`] = await saveFileAsNew(
        group[`${level}_upload`],
        createdBy,
        newGroupId,
        path.posix.join("upload", level)
      );

      // Video
      uploadFields[`${level}_video`] = await saveFileAsNew(
        group[`${level}_video`],
        createdBy,
        newGroupId,
        path.posix.join("video", level)
      );
    }

    // STEP 3: Update DB row with new file URLs
    await SessionPlanGroupService.updateSessionPlanGroup(
      newGroupId,
      { banner, ...uploadFields },
      createdBy
    );
    await createNotification(
      req,
      "Session Plan Group Duplicated",
      `Session Plan Group '${group.groupName}' (New ID: ${newGroupId}) was duplicated by ${req?.admin?.firstName || "Admin"}.`,
      "System"
    );

    await logActivity({
      panel: PANEL,
      module: MODULE,
      adminId: createdBy,
      action: "duplicate",
      description: `Duplicated session plan group: ${group.groupName} (Old ID: ${id}, New ID: ${newGroupId})`,
    });

    // STEP 4: Build response
    const responseData = {
      id: group.id,
      groupName: group.groupName,
      player: group.player,
      sortOrder: group.sortOrder || 0,
      createdAt: group.createdAt,
      updatedAt: group.updatedAt,
      banner,
      beginner_upload: uploadFields.beginner_upload,
      intermediate_upload: uploadFields.intermediate_upload,
      advanced_upload: uploadFields.advanced_upload,
      pro_upload: uploadFields.pro_upload,
      beginner_video: uploadFields.beginner_video,
      intermediate_video: uploadFields.intermediate_video,
      advanced_video: uploadFields.advanced_video,
      pro_video: uploadFields.pro_video,
      levels: group.levels,
    };

    return res.status(201).json({
      status: true,
      message: "Session Plan Group duplicated successfully.",
      data: responseData,
    });
  } catch (error) {
    console.error("Error in duplicateSessionPlanGroup:", error);
    return res.status(500).json({ status: false, message: "Server error." });
  }
};

exports.createSessionPlanGroup = async (req, res) => {
  try {
    const formData = req.body;
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

    if (!createdBy) return res.status(403).json({ status: false, message: "Unauthorized request" });

    const { groupName, levels, player } = formData;

    // Validate required fields
    const validation = validateFormData(formData, {
      requiredFields: ["groupName", "player", "levels"],
    });

    if (!validation.isValid) {
      const firstErrorMsg = Object.values(validation.error)[0];
      return res.status(400).json({ status: false, message: firstErrorMsg });
    }

    // Parse levels JSON
    let parsedLevels;
    try {
      parsedLevels = typeof levels === "string" ? JSON.parse(levels) : levels;
    } catch {
      return res.status(400).json({ status: false, message: "Invalid JSON for levels" });
    }

    // Validate levels
    const levelError = validateLevels(parsedLevels);
    if (levelError) return res.status(400).json({ status: false, message: levelError });

    // STEP 1: Create DB row without banner/video first
    const payloadWithoutFiles = { groupName, levels: parsedLevels, player, createdBy };
    const result = await SessionPlanGroupService.createSessionPlanGroup(payloadWithoutFiles);

    if (!result.status)
      return res.status(400).json({ status: false, message: result.message || "Failed to create session plan group." });

    const sessionPlanId = result.data.id; // ✅ DB-generated ID
    const baseUploadDir = path.join(
      process.cwd(),
      "uploads",
      "temp",
      "admin",
      `${createdBy}`,
      "session-plan-group",
      `${sessionPlanId}`
    );

    // Helper to save & upload files
    const saveAndUploadFile = async (file, type) => {
      const uniqueId = Math.floor(Math.random() * 1e9);
      const ext = path.extname(file.originalname).toLowerCase();
      const fileName = `${Date.now()}_${uniqueId}${ext}`;

      // Local path
      const localPath = path.join(baseUploadDir, type, fileName);
      await fs.promises.mkdir(path.dirname(localPath), { recursive: true });

      if (file.buffer) {
        await fs.promises.writeFile(localPath, file.buffer);
      } else {
        await saveFile(file, localPath);
      }

      // FTP path relative
      const relativeFtpPath = path.relative(path.join(process.cwd(), "uploads"), localPath).replace(/\\/g, "/");

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
    const banner = filesMap.banner?.[0] ? await saveAndUploadFile(filesMap.banner[0], "banner") : null;

    // STEP 3: Upload level-wise uploads & videos
    const attachUploadsAndVideos = async (levelsObj) => {
      const uploadFields = {};
      for (const level of ["beginner", "intermediate", "advanced", "pro"]) {
        // Upload file
        const fileArr = filesMap[`${level}_upload`];
        if (fileArr && fileArr[0]) {
          uploadFields[`${level}_upload`] = await saveAndUploadFile(fileArr[0], path.join("upload", level));
        } else {
          uploadFields[`${level}_upload`] = null;
        }

        // Video file
        const videoArr = filesMap[`${level}_video`];
        if (videoArr && videoArr[0]) {
          uploadFields[`${level}_video`] = await saveAndUploadFile(videoArr[0], path.join("video", level));
        } else {
          uploadFields[`${level}_video`] = null;
        }
      }
      return { levelsObj, uploadFields };
    };

    const { levelsObj: levelsWithFiles, uploadFields } = await attachUploadsAndVideos(parsedLevels);

    // STEP 4: Update DB row with banner and all files
    const updatePayload = { banner, ...uploadFields };
    await SessionPlanGroupService.updateSessionPlanGroup(sessionPlanId, updatePayload, createdBy);

    // ✅ NEW: Create notification & activity log
    await createNotification(
      req,
      "Session Plan Group Created",
      `A new Session Plan Group '${result.data.groupName}' was created by ${req?.admin?.firstName || "Admin"}.`,
      "System"
    );

    await logActivity({
      panel: PANEL,
      module: MODULE,
      adminId: createdBy,
      action: "create",
      description: `Created new session plan group: ${result.data.groupName}`,
    });
    // STEP 5: Build response
    const responseData = {
      id: sessionPlanId,
      groupName: result.data.groupName,
      type: "weekly_classes",
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
    console.error("Server error in createSessionPlanGroup:", error);
    return res.status(500).json({
      status: false,
      message: "Server error occurred while creating the session plan group.",
    });
  }
};

// exports.getSessionPlanGroupDetails = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const createdBy = req.admin?.id || req.user?.id;

//     if (DEBUG)
//       console.log("Fetching session plan group id:", id, "user:", createdBy);

//     const result = await SessionPlanGroupService.getSessionPlanGroupById(
//       id,
//       createdBy
//     );

//     if (!result.status) {
//       if (DEBUG) console.warn("Session plan group not found:", id);
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
//       if (DEBUG) console.error("Failed to parse levels:", err);
//       parsedLevels = {};
//     }

//     const sessionExercises = await SessionExercise.findAll({
//       where: { createdBy },
//     });
//     const exerciseMap = sessionExercises.reduce((acc, ex) => {
//       acc[ex.id] = ex;
//       return acc;
//     }, {});

//     // ✅ Calculate elapsed time since video upload using createdAt
//     let videoUploadedAgo = null;
//     if (group.video) {
//       const now = new Date();
//       const created = new Date(group.createdAt);
//       const diffMs = now - created;
//       const diffSeconds = Math.floor(diffMs / 1000);
//       const diffMinutes = Math.floor(diffSeconds / 60);
//       const diffHours = Math.floor(diffMinutes / 60);
//       const diffDays = Math.floor(diffHours / 24);

//       if (diffDays > 0) videoUploadedAgo = `${diffDays} day(s) ago`;
//       else if (diffHours > 0) videoUploadedAgo = `${diffHours} hour(s) ago`;
//       else if (diffMinutes > 0) videoUploadedAgo = `${diffMinutes} minute(s) ago`;
//       else videoUploadedAgo = `${diffSeconds} second(s) ago`;
//     }

//     if (DEBUG) console.log("Video uploaded ago:", videoUploadedAgo);

//     return res.status(200).json({
//       status: true,
//       message: "Fetched session plan group with exercises.",
//       data: {
//         ...group,
//         levels: parsedLevels,
//         videoUploadedAgo, // ✅ Only change
//       },
//     });
//   } catch (error) {
//     if (DEBUG) console.error("Error in getSessionPlanGroupDetails:", error);
//     return res.status(500).json({ status: false, message: "Server error." });
//   }
// };

// exports.duplicateSessionPlanGroup = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const createdBy = req.admin?.id || req.user?.id;

//     if (DEBUG) console.log("Duplicating session plan group:", id);

//     // Call service
//     const result = await SessionPlanGroupService.duplicateSessionPlanGroup(id, createdBy);

//     if (!result.status) return res.status(404).json({ status: false, message: result.message });

//     // Build response exactly like createSessionPlanGroup
//     const group = result.data;
//     const responseData = {
//       id: group.id,
//       groupName: group.groupName,
//       player: group.player,
//       sortOrder: group.sortOrder || 0,
//       createdAt: group.createdAt,
//       updatedAt: group.updatedAt,
//       banner: group.banner,
//       video: group.video,
//       beginner_recording: group.beginner_recording,
//       intermediate_recording: group.intermediate_recording,
//       advanced_recording: group.advanced_recording,
//       pro_recording: group.pro_recording,
//       levels: group.levels, // ✅ full object/array preserved
//     };

//     return res.status(201).json({
//       status: true,
//       message: "Session Plan Group duplicated successfully.",
//       data: responseData,
//     });
//   } catch (error) {
//     if (DEBUG) console.error("Error in duplicateSessionPlanGroup:", error);
//     return res.status(500).json({ status: false, message: "Server error." });
//   }
// };

// exports.getSessionPlanGroupDetails = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const createdBy = req.admin?.id || req.user?.id;

//     if (DEBUG)
//       console.log("Fetching session plan group id:", id, "user:", createdBy);

//     const result = await SessionPlanGroupService.getSessionPlanGroupById(
//       id,
//       createdBy
//     );

//     if (!result.status) {
//       if (DEBUG) console.warn("Session plan group not found:", id);
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
//       if (DEBUG) console.error("Failed to parse levels:", err);
//       parsedLevels = {};
//     }

//     const sessionExercises = await SessionExercise.findAll({
//       where: { createdBy },
//     });
//     const exerciseMap = sessionExercises.reduce((acc, ex) => {
//       acc[ex.id] = ex;
//       return acc;
//     }, {});

//     // ✅ Only change: calculate main group video duration using videoHelper
//     let totalVideoTime = await getVideoDurationInSeconds(group.video);
//     const formattedTime = formatDuration(totalVideoTime);

//     if (DEBUG) console.log("Total video time:", formattedTime);

//     return res.status(200).json({
//       status: true,
//       message: "Fetched session plan group with exercises.",
//       data: {
//         ...group,
//         levels: parsedLevels,
//         totalVideoTime: formattedTime,
//       },
//     });
//   } catch (error) {
//     if (DEBUG) console.error("Error in getSessionPlanGroupDetails:", error);
//     return res.status(500).json({ status: false, message: "Server error." });
//   }
// };

// ✅ Validate Levels (stop on first missing field)
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

// exports.getSessionPlanGroupDetails = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const createdBy = req.admin?.id || req.user?.id;

//     if (DEBUG)
//       console.log("Fetching session plan group id:", id, "user:", createdBy);

//     const result = await SessionPlanGroupService.getSessionPlanGroupById(
//       id,
//       createdBy
//     );

//     if (!result.status) {
//       if (DEBUG) console.warn("Session plan group not found:", id);
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
//       if (DEBUG) console.error("Failed to parse levels:", err);
//       parsedLevels = {};
//     }

//     const sessionExercises = await SessionExercise.findAll({
//       where: { createdBy },
//     });
//     const exerciseMap = sessionExercises.reduce((acc, ex) => {
//       acc[ex.id] = ex;
//       return acc;
//     }, {});

//     // ✅ Helper to calculate elapsed time
//     const getElapsedTime = (createdAt) => {
//       const now = new Date();
//       const created = new Date(createdAt);
//       const diffMs = now - created;
//       const diffSeconds = Math.floor(diffMs / 1000);
//       const diffMinutes = Math.floor(diffSeconds / 60);
//       const diffHours = Math.floor(diffMinutes / 60);
//       const diffDays = Math.floor(diffHours / 24);

//       if (diffDays > 0) return `${diffDays} day(s) ago`;
//       if (diffHours > 0) return `${diffHours} hour(s) ago`;
//       if (diffMinutes > 0) return `${diffMinutes} minute(s) ago`;
//       return `${diffSeconds} second(s) ago`;
//     };

//     // ✅ Calculate elapsed times for level videos
//     const videoUploadedAgo = {};
//     for (const level of ["beginner", "intermediate", "advanced", "pro"]) {
//       if (group[`${level}_video`]) {
//         videoUploadedAgo[`${level}_video`] = getElapsedTime(group.createdAt);
//       } else {
//         videoUploadedAgo[`${level}_video`] = null;
//       }
//     }

//     if (DEBUG) console.log("Video uploadedAgo map:", videoUploadedAgo);

//     return res.status(200).json({
//       status: true,
//       message: "Fetched session plan group with exercises.",
//       data: {
//         ...group,
//         levels: parsedLevels,
//         videoUploadedAgo, // ✅ Now level-wise map
//       },
//     });
//   } catch (error) {
//     if (DEBUG) console.error("Error in getSessionPlanGroupDetails:", error);
//     return res.status(500).json({ status: false, message: "Server error." });
//   }
// };

exports.getSessionPlanGroupDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const createdBy = req.admin?.id || req.user?.id;

    const mainSuperAdminResult = await getMainSuperAdminOfAdmin(req.admin.id);
    const superAdminId = mainSuperAdminResult?.superAdmin.id ?? null;

    if (DEBUG)
      console.log("Fetching session plan group id:", id, "user:", createdBy);

    const result = await SessionPlanGroupService.getSessionPlanGroupById(id, superAdminId);

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

exports.getAllSessionPlanGroups = async (req, res) => {
  try {
    const createdBy = req.admin?.id || req.user?.id;
    console.log("Fetching session plan groups for createdBy:", createdBy);

    if (!createdBy) {
      return res.status(400).json({
        status: false,
        message: "Unauthorized request: missing admin or user ID.",
      });
    }

    // Get top-level super admin (if exists)
    const mainSuperAdminResult = await getMainSuperAdminOfAdmin(req.admin.id);
    const superAdminId = mainSuperAdminResult?.superAdmin.id ?? createdBy;

    // Fetch session plan groups from service
    const result = await SessionPlanGroupService.getAllSessionPlanGroups({ createdBy });

    if (!result.status) {
      await logActivity(req, PANEL, MODULE, "list", result, false);
      return res.status(500).json({ status: false, message: result.message });
    }

    const { groups } = result.data;

    // Fetch exercises once to build exercise map
    const sessionExercises = await SessionExercise.findAll({ where: { createdBy } });
    const exerciseMap = sessionExercises.reduce((acc, ex) => {
      acc[ex.id] = ex;
      return acc;
    }, {});

    // Helper to calculate elapsed time
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

    const levelsList = ["beginner", "intermediate", "advanced", "pro"];

    // Process all groups
    const formattedData = await Promise.all(
      groups.map(async (group) => {
        // Parse levels
        let parsedLevels = {};
        try {
          parsedLevels =
            typeof group.levels === "string"
              ? JSON.parse(group.levels)
              : group.levels || {};
        } catch {
          parsedLevels = {};
        }

        // Map exercises to levels
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

        // Add video info for each level
        const videoInfo = {};
        await Promise.all(
          levelsList.map(async (level) => {
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

        return {
          ...group,
          levels: parsedLevels,
          ...videoInfo,
        };
      })
    );

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
      message: "Fetched session plan groups with exercises and video info successfully.",
      data: formattedData,
    });
  } catch (error) {
    console.error("❌ Controller Error:", error);
    return res.status(500).json({ status: false, message: "Server error" });
  }
};

// exports.downloadSessionPlanGroupVideo = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const filename = req.query.filename;
//     const createdBy = req.admin?.id || req.user?.id;

//     const result = await SessionPlanGroupService.getSessionPlanGroupVideoStream(
//       id,
//       createdBy,
//       filename
//     );

//     if (!result.status) {
//       return res.status(404).json({ status: false, message: result.message });
//     }

//     res.setHeader("Content-Type", "video/mp4");
//     res.setHeader(
//       "Content-Disposition",
//       `attachment; filename="${result.filename}"`
//     );

//     // Pipe stream to response
//     result.stream.pipe(res);
//   } catch (error) {
//     console.error("❌ Error in downloadSessionPlanGroupVideo:", error);
//     res.status(500).json({ status: false, message: "Server error." });
//   }
// };

exports.downloadSessionPlanGroupVideo = async (req, res) => {
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

// exports.updateSessionPlanGroup = async (req, res) => {
//   const { id } = req.params;
//   const { groupName, levels, player } = req.body;
//   const adminId = req.admin?.id;
//   const files = req.files || {};

//   if (!adminId) {
//     return res.status(401).json({ status: false, message: "Unauthorized: Admin ID not found." });
//   }

//   console.log("STEP 1: Received request", { id, groupName, levels, player, files: Object.keys(files) });

//   try {
//     // STEP 2: Fetch existing group
//     const existingResult = await SessionPlanGroupService.getSessionPlanGroupById(id, adminId);
//     if (!existingResult.status || !existingResult.data) {
//       console.log("STEP 2: Session Plan Group not found");
//       return res.status(404).json({ status: false, message: "Session Plan Group not found" });
//     }
//     const existing = existingResult.data;
//     console.log("STEP 2: Existing group fetched:", existing);

//     // STEP 3: Parse levels
//     let parsedLevels = existing.levels || {};
//     if (levels) {
//       parsedLevels = typeof levels === "string" ? JSON.parse(levels) : levels;

//       // Merge with existing levels, replacing only provided keys
//       parsedLevels = {
//         ...existing.levels,   // keep existing levels
//         ...parsedLevels       // overwrite with new levels
//       };
//     }
//     console.log("STEP 3: Parsed levels:", parsedLevels);

//     // STEP 4: Helper to save files if new file provided (returns FTP URL)
//     const saveFileIfExists = async (file, type, oldUrl = null, level = null) => {
//       if (!file) return oldUrl || null;

//       const path = require("path");
//       const fs = require("fs").promises;

//       const uniqueId = Date.now() + "_" + Math.floor(Math.random() * 1e9);
//       const ext = path.extname(file.originalname || "file");
//       const fileName = uniqueId + ext;

//       // Local path
//       const localPath = path.join(
//         process.cwd(),
//         "uploads",
//         "temp",
//         "admin",
//         `${adminId}`,
//         "session-plan-group",
//         `${id}`,
//         type,
//         level || "",
//         fileName
//       );

//       console.log(`STEP 4: Saving file locally at:`, localPath);
//       await fs.mkdir(path.dirname(localPath), { recursive: true });
//       await saveFile(file, localPath);

//       let uploadedUrl = null;
//       try {
//         // Preserve folder structure for FTP
//         const relativeFtpPath = path
//           .relative(path.join(process.cwd(), "uploads"), localPath)
//           .replace(/\\/g, "/"); // convert Windows \ to /

//         uploadedUrl = await uploadToFTP(localPath, relativeFtpPath); // returns public URL with full path
//         console.log(`STEP 4: Uploaded ${type}/${level || ""} to FTP:`, uploadedUrl);
//       } catch (err) {
//         console.error(`STEP 4: Failed to upload ${type}/${level || ""}`, err);
//       } finally {
//         await fs.unlink(localPath).catch(() => { });
//       }

//       return uploadedUrl || oldUrl;
//     };

//     // STEP 5: Flatten files and detect
//     const allFiles = Object.values(files).flat();
//     console.log("STEP 5: All uploaded files:", allFiles.map(f => f.fieldname || f.originalname));

//     const bannerFile = allFiles.find(
//       f =>
//         f.fieldname?.toLowerCase().includes("banner") ||
//         f.originalname?.toLowerCase().includes("banner")
//     );

//     const videoFile = allFiles.find(
//       f =>
//         f.fieldname?.toLowerCase().includes("video") ||
//         f.originalname?.toLowerCase().includes("video")
//     );

//     const banner = await saveFileIfExists(bannerFile, "banner", existing.banner);
//     const video = await saveFileIfExists(videoFile, "video", existing.video);

//     console.log("STEP 5: Banner URL after update:", banner);
//     console.log("STEP 5: Video URL after update:", video);

//     // STEP 6: Update recordings
//     const uploadFields = {};
//     for (const level of ["beginner", "intermediate", "advanced", "pro"]) {
//       const fileArr =
//         files[`${level}_upload`] ||
//         files[`${level}_upload_file`] ||
//         files[level] ||
//         allFiles.filter(f => f.originalname?.toLowerCase().includes(level)) ||
//         [];

//       uploadFields[`${level}_upload`] = fileArr?.[0]
//         ? await saveFileIfExists(fileArr[0], "upload", existing[`${level}_upload`], level)
//         : existing[`${level}_upload`] || null;

//       console.log(`STEP 6: uploadFields[${level}_upload] =`, uploadFields[`${level}_upload`]);
//     }

//     // STEP 7: Prepare update payload
//     const updatePayload = {
//       groupName: groupName?.trim() || existing.groupName,
//       levels: parsedLevels,
//       player: player || existing.player,
//       banner,
//       video,
//       ...uploadFields,
//     };

//     console.log("STEP 7: updatePayload =", updatePayload);

//     // STEP 8: Update DB
//     const updateResult = await SessionPlanGroupService.updateSessionPlanGroup(id, updatePayload, adminId);
//     if (!updateResult.status) {
//       console.log("STEP 8: DB update failed");
//       return res.status(500).json({ status: false, message: "Update failed." });
//     }
//     const updated = updateResult.data;

//     // STEP 9: Prepare response
//     const responseData = {
//       id: updated.id,
//       groupName: updated.groupName,
//       player: updated.player,
//       banner: updated.banner,
//       video: updated.video,
//       levels: typeof updated.levels === "string" ? JSON.parse(updated.levels) : updated.levels,
//       beginner_upload: updated.beginner_upload,
//       intermediate_upload: updated.intermediate_upload,
//       advanced_upload: updated.advanced_upload,
//       pro_upload: updated.pro_upload,
//       createdAt: updated.createdAt,
//       updatedAt: updated.updatedAt,
//     };

//     console.log("STEP 9: Final responseData =", responseData);
//     return res.status(200).json({
//       status: true,
//       message: "Session Plan Group updated successfully.",
//       data: responseData,
//     });

//   } catch (error) {
//     console.error("STEP 10: Update error:", error);
//     return res.status(500).json({ status: false, message: "Failed to update Session Plan Group." });
//   }

// };

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
    const existingResult = await SessionPlanGroupService.getSessionPlanGroupById(id, adminId);
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
    // STEP 9: Log and notify
    await logActivity(
      req,
      "Admin", // PANEL name
      "Session-Plan-Group", // MODULE name
      "update", // Action type
      {
        oneLineMessage: `Session Plan Group '${updatePayload.groupName}' (ID: ${id}) updated by ${req?.admin?.firstName || "Admin"}.`
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

exports.deleteSessionPlanGroup = async (req, res) => {
  const { id } = req.params;
  const adminId = req.admin?.id; // ✅ track who deleted

  if (DEBUG) console.log(`🗑️ Deleting Session Plan Group ID: ${id}`);

  try {
    // ✅ Check if group exists
    const existingResult = await SessionPlanGroupService.getSessionPlanGroupById(id, adminId);

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
    const deleteResult = await SessionPlanGroupService.deleteSessionPlanGroup(
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
exports.deleteSessionPlanGroupLevel = async (req, res) => {
  const { id, levelKey } = req.params;
  const adminId = req.admin?.id; // ✅

  console.log("============================================");
  console.log("📌 CONTROLLER: deleteSessionPlanGroupLevel");
  console.log("📌 Incoming Params:", { id, levelKey });
  console.log("➡️ Calling service.deleteLevelFromSessionPlanGroup...");

  try {
    const result =
      await SessionPlanGroupService.deleteLevelFromSessionPlanGroup(
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

// 📌 Controller: Reorder Session Plan Groups
exports.reorderSessionPlanGroups = async (req, res) => {
  const { orderedIds } = req.body;
  const adminId = req.admin?.id;

  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    return res.status(400).json({
      status: false,
      message: "orderedIds must be a non-empty array",
    });
  }

  try {
    const result = await SessionPlanGroupService.reorderSessionPlanGroups(
      orderedIds,
      adminId
    );

    if (!result.status) {
      return res.status(500).json({
        status: false,
        message: result.message || "Failed to reorder session plan groups",
      });
    }

    await logActivity(
      req,
      PANEL,
      MODULE,
      "reorder",
      {
        oneLineMessage: `Reordered ${orderedIds.length} session plan groups`,
      },
      true
    );

    return res.status(200).json({
      status: true,
      message: "Session plan groups reordered successfully",
      data: result.data,
    });
  } catch (error) {
    console.error("❌ reorderSessionPlanGroups controller error:", error);
    return res.status(500).json({
      status: false,
      message: "Failed to reorder session plan groups",
    });
  }
};

const { validateFormData } = require("../../../utils/validateFormData");
const SessionPlanGroupService = require("../../../services/admin/sessionPlan/sessionPlanGroup");
const SessionExerciseService = require("../../../services/admin/sessionPlan/sessionExercise");
const { logActivity } = require("../../../utils/admin/activityLogger");
const { getVideoDurationInSeconds } = require("../../../utils/videoHelper");
const uploadToFTP = require("../../../utils/uploadToFTP");
const {
  createNotification,
} = require("../../../utils/admin/notificationHelper");
const { SessionExercise } = require("../../../models");
const path = require("path");
const { saveFile, deleteFile } = require("../../../utils/fileHandler");
const fs = require("fs");

const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "session-plan-group";

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

exports.createSessionPlanGroup = async (req, res) => {
  try {
    const formData = req.body;
    // normalize req.files: multer.any() -> array, or multer.fields() -> object
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

    const createdBy = req.admin?.id || req.user?.id;
    const DEBUG = true;

    if (DEBUG) console.log("📥 Received formData:", formData);
    if (DEBUG) console.log("📥 Received files:", Object.keys(filesMap));

    if (!createdBy) {
      if (DEBUG) console.log("❌ Unauthorized request: no user/admin id");
      return res
        .status(403)
        .json({ status: false, message: "Unauthorized request" });
    }

    const { groupName, levels, player } = formData;

    // Validate required fields
    const validation = validateFormData(formData, {
      requiredFields: ["groupName", "player", "levels"],
    });

    if (!validation.isValid) {
      const firstErrorMsg = Object.values(validation.error)[0];
      if (DEBUG) console.log("❌ Validation failed:", firstErrorMsg);
      await logActivity(req, PANEL, MODULE, "create", firstErrorMsg, false);
      return res.status(400).json({ status: false, message: firstErrorMsg });
    }

    // Parse levels JSON
    let parsedLevels;
    try {
      parsedLevels = typeof levels === "string" ? JSON.parse(levels) : levels;
      if (DEBUG) console.log("✅ Parsed levels:", parsedLevels);
    } catch (err) {
      if (DEBUG) console.log("❌ Failed to parse levels JSON:", err.message);
      return res
        .status(400)
        .json({ status: false, message: "Invalid JSON for levels" });
    }

    // Validate levels
    const levelError = validateLevels(parsedLevels);
    if (levelError) {
      if (DEBUG) console.log("❌ Levels validation error:", levelError);
      return res.status(400).json({ status: false, message: levelError });
    }

    const baseUploadDir = path.join(
      process.cwd(),
      "uploads",
      "temp",
      "admin",
      `${createdBy}`,
      "session-plan-group"
    );

    // Helper to save & upload file (unchanged)
    const saveAndUploadFile = async (file, type) => {
      const uniqueId = Math.floor(Math.random() * 1e9);
      const ext = path.extname(file.originalname).toLowerCase();
      const fileName = `${Date.now()}_${uniqueId}${ext}`;
      const localPath = path.join(baseUploadDir, type, fileName);

      await fs.promises.mkdir(path.dirname(localPath), { recursive: true });

      // If multer used memoryStorage => file.buffer exists; handle both cases
      if (file.buffer) {
        await fs.promises.writeFile(localPath, file.buffer);
      } else if (file.path) {
        // file already on disk (multer diskStorage)
        await saveFile(file, localPath);
      } else {
        // fallback: try saveFile as before
        await saveFile(file, localPath);
      }

      if (DEBUG) console.log(`💾 Saved ${type} locally at:`, localPath);

      let uploadedPath = null;
      try {
        uploadedPath = await uploadToFTP(localPath, fileName);
        if (DEBUG) console.log(`☁️ Uploaded ${type} to FTP:`, uploadedPath);
      } catch (err) {
        console.error(`❌ Failed to upload ${type}:`, err.message);
      } finally {
        await fs.promises.unlink(localPath).catch(() => {});
      }

      return uploadedPath;
    };

    // Save top-level banner & video (if present)
    const banner = filesMap.banner?.[0]
      ? await saveAndUploadFile(filesMap.banner[0], "banner")
      : null;
    const video = filesMap.video?.[0]
      ? await saveAndUploadFile(filesMap.video[0], "video")
      : null;

    if (DEBUG) console.log("📌 Banner URL:", banner);
    if (DEBUG) console.log("📌 Video URL:", video);

    // Attach recordings into each level/session. Expect frontend keys: recording_<level>_<index>
    const attachRecordingsToLevels = async (levelsObj) => {
      for (const [level, sessions] of Object.entries(levelsObj)) {
        const fieldName = `recording_${level}`;
        const fileArr = filesMap[fieldName];

        let uploadedRecording = null;
        if (fileArr && fileArr[0]) {
          try {
            uploadedRecording = await saveAndUploadFile(
              fileArr[0],
              path.join("recording", level)
            );
            if (DEBUG)
              console.log(
                `🎙️ Attached recording for ${level}:`,
                uploadedRecording
              );
          } catch (err) {
            console.error(
              `❌ Error saving recording for ${level}:`,
              err.message
            );
          }
        }

        // apply same recording to all sessions in this level
        sessions.forEach((session) => {
          session.recording = uploadedRecording;
        });
      }

      return levelsObj;
    };

    const levelsWithRecordings = await attachRecordingsToLevels(parsedLevels);

    // Build DB payload
    const payload = {
      groupName,
      levels: levelsWithRecordings,
      createdBy,
      player,
      banner,
      video,
    };

    if (DEBUG) console.log("📌 DB payload:", payload);

    const result = await SessionPlanGroupService.createSessionPlanGroup(
      payload
    );
    if (DEBUG) console.log("📌 DB result:", result);

    if (!result.status) {
      if (DEBUG) console.log("❌ Failed to create session plan group");
      await logActivity(req, PANEL, MODULE, "create", result, false);
      return res.status(400).json({
        status: false,
        message: result.message || "Failed to create session plan group.",
      });
    }

    // Collect all sessionExerciseIds
    const allExerciseIds = [];
    Object.values(levelsWithRecordings).forEach((sessions) => {
      sessions.forEach((session) => {
        if (Array.isArray(session.sessionExerciseId)) {
          allExerciseIds.push(...session.sessionExerciseId);
        }
      });
    });

    if (DEBUG) console.log("📌 All exercise IDs to fetch:", allExerciseIds);

    // Build clean response
    const responseLevels = {};
    for (const [level, sessions] of Object.entries(levelsWithRecordings)) {
      responseLevels[level] = sessions.map((session) => ({
        skillOfTheDay: session.skillOfTheDay,
        description: session.description,
        sessionExerciseId: session.sessionExerciseId || [],
        recording: session.recording || null, // ✅ included
      }));
    }

    const responseData = {
      id: result.data.id,
      groupName: result.data.groupName,
      player: result.data.player,
      sortOrder: result.data.sortOrder || 0,
      status: result.data.status || "active",
      createdAt: result.data.createdAt,
      updatedAt: result.data.updatedAt,
      banner,
      video,
      levels: responseLevels,
    };

    if (DEBUG) console.log("📦 Final responseData:", responseData);

    await logActivity(
      req,
      PANEL,
      MODULE,
      "create",
      { oneLineMessage: `Created session plan group: ${groupName}` },
      true
    );

    await createNotification(
      req,
      "Session Plan Group Created",
      `Session Plan Group '${groupName}' was created by ${
        req?.admin?.firstName || "Admin"
      }.`,
      "System"
    );

    return res.status(201).json({
      status: true,
      message: "Session Plan Group created successfully.",
      data: responseData,
    });
  } catch (error) {
    console.error("❌ Server error in createSessionPlanGroup:", error);
    await logActivity(
      req,
      PANEL,
      MODULE,
      "create",
      { error: error.message },
      false
    );
    return res.status(500).json({
      status: false,
      message: "Server error occurred while creating the session plan group.",
    });
  }
};

exports.getAllSessionPlanGroups = async (req, res) => {
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

exports.getSessionPlanGroupDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const createdBy = req.admin?.id || req.user?.id;

    if (DEBUG)
      console.log("Fetching session plan group id:", id, "user:", createdBy);

    const result = await SessionPlanGroupService.getSessionPlanGroupById(
      id,
      createdBy
    );

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

    const sessionExercises = await SessionExercise.findAll({
      where: { createdBy },
    });
    const exerciseMap = sessionExercises.reduce((acc, ex) => {
      acc[ex.id] = ex;
      return acc;
    }, {});

    // Add main group video duration
    let totalVideoTime = 0;

    // Only calculate the main group video duration
    totalVideoTime += await getVideoDurationInSeconds(group.video);

    // Convert seconds to HH:MM:SS
    const hours = Math.floor(totalVideoTime / 3600);
    const minutes = Math.floor((totalVideoTime % 3600) / 60);
    const seconds = Math.floor(totalVideoTime % 60);
    const formattedTime = `${String(hours).padStart(2, "0")}:${String(
      minutes
    ).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

    if (DEBUG) console.log("Total video time:", formattedTime);

    return res.status(200).json({
      status: true,
      message: "Fetched session plan group with exercises.",
      data: {
        ...group,
        levels: parsedLevels,
        totalVideoTime: formattedTime,
      },
    });
  } catch (error) {
    if (DEBUG) console.error("Error in getSessionPlanGroupDetails:", error);
    return res.status(500).json({ status: false, message: "Server error." });
  }
};

exports.downloadSessionPlanGroupVideo = async (req, res) => {
  try {
    const { id } = req.params;
    const filename = req.query.filename;
    const createdBy = req.admin?.id || req.user?.id;

    const result = await SessionPlanGroupService.getSessionPlanGroupVideoStream(
      id,
      createdBy,
      filename
    );

    if (!result.status) {
      return res.status(404).json({ status: false, message: result.message });
    }

    res.setHeader("Content-Type", "video/mp4");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${result.filename}"`
    );

    // Pipe stream to response
    result.stream.pipe(res);
  } catch (error) {
    console.error("❌ Error in downloadSessionPlanGroupVideo:", error);
    res.status(500).json({ status: false, message: "Server error." });
  }
};

// ✅ UPDATE Session Plan Group
// exports.updateSessionPlanGroup = async (req, res) => {
//   const { id } = req.params;
//   const formData = req.body;
//   const adminId = req.admin?.id;
//   const files = req.files || {};

//   if (!adminId) {
//     return res.status(401).json({
//       status: false,
//       message: "Unauthorized: Admin ID not found.",
//     });
//   }

//   if (DEBUG) {
//     console.log("🛠️ STEP 1: Updating Session Plan Group ID:", id);
//     console.log("📥 Received Update FormData:", formData);
//     console.log("📎 Uploaded Files:", Object.keys(files));
//   }

//   try {
//     // ✅ STEP 2: Fetch existing group by ID + createdBy
//     const existingResult =
//       await SessionPlanGroupService.getSessionPlanGroupById(id, adminId);
//     if (!existingResult.status || !existingResult.data) {
//       return res.status(404).json({
//         status: false,
//         message: existingResult.message || "Session Plan Group not found.",
//       });
//     }

//     const existing = existingResult.data;

//     // ✅ STEP 3: Parse levels JSON safely
//     let parsedLevels = {};
//     if (formData.levels) {
//       try {
//         parsedLevels =
//           typeof formData.levels === "string"
//             ? JSON.parse(formData.levels)
//             : formData.levels;
//       } catch (err) {
//         return res.status(400).json({
//           status: false,
//           message: "Invalid JSON format for levels",
//         });
//       }
//     }

//     // ✅ STEP 4: Build updatePayload
//     // const updatePayload = {};
//     // if (formData.groupName) updatePayload.groupName = formData.groupName.trim();
//     // if (Object.keys(parsedLevels).length > 0) {
//     //   updatePayload.levels = parsedLevels;
//     // }
//     // ✅ STEP 4: Build updatePayload
//     // ✅ STEP 4: Build updatePayload
//     // ✅ STEP 4: Build updatePayload
//     // ✅ STEP 4: Build updatePayload
//     const updatePayload = {};
//     if (formData.groupName) {
//       updatePayload.groupName = formData.groupName.trim();
//     }

//     // Merge only provided levels, preserve others exactly
//     if (Object.keys(parsedLevels).length > 0) {
//       let existingLevels = {};
//       try {
//         existingLevels =
//           typeof existing.levels === "string"
//             ? JSON.parse(existing.levels)
//             : existing.levels || {};
//       } catch (_) {
//         existingLevels = {};
//       }

//       const mergedLevels = {};

//       // Loop through all level keys (beginner, intermediate, etc.)
//       const levelKeys = ["beginner", "intermediate", "advanced", "pro"];
//       for (const level of levelKeys) {
//         if (parsedLevels[level]) {
//           // We're updating this level
//           const incomingEntries = parsedLevels[level] || [];
//           const existingEntries = Array.isArray(existingLevels[level])
//             ? existingLevels[level]
//             : [];

//           const mergedEntries = [];

//           const maxLength = Math.max(
//             incomingEntries.length,
//             existingEntries.length
//           );

//           for (let i = 0; i < maxLength; i++) {
//             const incoming = incomingEntries[i] || {};
//             const existing = existingEntries[i] || {};
//             const merged = { ...existing };

//             for (const key in incoming) {
//               merged[key] = incoming[key]; // overwrite only provided keys
//             }

//             mergedEntries.push(merged);
//           }

//           mergedLevels[level] = mergedEntries;
//         } else if (existingLevels[level]) {
//           // Not updating this level, keep it as-is
//           mergedLevels[level] = existingLevels[level];
//         }
//       }

//       updatePayload.levels = mergedLevels;
//     }

//     // ✅ STEP 5: Handle file uploads
//     const baseUploadDir = path.join(
//       process.cwd(),
//       "uploads",
//       "session-plan-groups"
//     );

//     const saveAndReplaceFile = async (file, level, type, oldPath) => {
//       const ext = path.extname(file.originalname).toLowerCase();
//       const fileName = `${Date.now()}_${Math.floor(Math.random() * 1e9)}${ext}`;
//       const levelDir = path.join(baseUploadDir, level);
//       await fs.promises.mkdir(levelDir, { recursive: true });

//       const fullPath = path.join(levelDir, fileName);
//       const relativePath = `uploads/session-plan-groups/${level}/${fileName}`;

//       try {
//         await saveFile(file, fullPath);
//         if (oldPath) await deleteFile(oldPath);
//         return relativePath;
//       } catch (err) {
//         console.error(`❌ File save failed (${level} - ${type}):`, err.message);
//         return oldPath || null;
//       }
//     };

//     const levelKeys = ["beginner", "intermediate", "advanced", "pro"];
//     for (const level of levelKeys) {
//       const banner = `${level}_banner`;
//       const video = `${level}_video`;

//       if (files[banner]?.[0]) {
//         updatePayload[banner] = await saveAndReplaceFile(
//           files[banner][0],
//           level,
//           "banner",
//           existing[banner]
//         );
//       }

//       if (files[video]?.[0]) {
//         updatePayload[video] = await saveAndReplaceFile(
//           files[video][0],
//           level,
//           "video",
//           existing[video]
//         );
//       }
//     }

//     if (Object.keys(updatePayload).length === 0) {
//       return res.status(400).json({
//         status: false,
//         message: "No valid fields provided to update.",
//       });
//     }

//     // ✅ STEP 6: Call service with createdBy
//     const updateResult = await SessionPlanGroupService.updateSessionPlanGroup(
//       id,
//       updatePayload,
//       adminId
//     );
//     if (!updateResult.status) {
//       return res.status(500).json({
//         status: false,
//         message: updateResult.message || "Update failed.",
//       });
//     }

//     const updated = updateResult.data;

//     // ✅ STEP 7: Rebuild levels with sessionExercise details
//     let cleanLevels = {};
//     try {
//       cleanLevels =
//         typeof updated.levels === "string"
//           ? JSON.parse(updated.levels)
//           : updated.levels || {};
//     } catch (_) {
//       cleanLevels = {};
//     }

//     let allIds = [];
//     Object.values(cleanLevels).forEach((levelArr) => {
//       levelArr.forEach((entry) => {
//         if (Array.isArray(entry.sessionExerciseId)) {
//           allIds.push(...entry.sessionExerciseId);
//         }
//       });
//     });

//     let exerciseMap = {};
//     if (allIds.length > 0) {
//       const uniqueIds = [...new Set(allIds)];
//       const exercises = await SessionExercise.findAll({
//         where: { id: uniqueIds },
//         raw: true,
//       });
//       exercises.forEach((ex) => (exerciseMap[ex.id] = ex));
//     }

//     for (const level in cleanLevels) {
//       cleanLevels[level] = cleanLevels[level].map((entry) => ({
//         ...entry,
//         sessionExercises: (entry.sessionExerciseId || [])
//           .map((id) => exerciseMap[id])
//           .filter(Boolean),
//       }));
//     }

//     // ✅ STEP 8: Final response
//     const responseData = {
//       id: updated.id,
//       groupName: updated.groupName,
//       beginner_banner: updated.beginner_banner || null,
//       beginner_video: updated.beginner_video || null,
//       intermediate_banner: updated.intermediate_banner || null,
//       intermediate_video: updated.intermediate_video || null,
//       advanced_banner: updated.advanced_banner || null,
//       advanced_video: updated.advanced_video || null,
//       pro_banner: updated.pro_banner || null,
//       pro_video: updated.pro_video || null,
//       levels: cleanLevels,
//       createdAt: updated.createdAt,
//       updatedAt: updated.updatedAt,
//     };

//     if (DEBUG) console.log("✅ Update successful:", responseData);

//     await logActivity(
//       req,
//       PANEL,
//       MODULE,
//       "update",
//       {
//         oneLineMessage: `Updated Session Plan Group ID: ${id}`,
//       },
//       true
//     );

//     await createNotification(
//       req,
//       "Session Plan Group Updated",
//       `Session Plan Group '${updated.groupName}' was updated by ${
//         req?.admin?.firstName || "Admin"
//       }.`,
//       "System"
//     );

//     return res.status(200).json({
//       status: true,
//       message: "Session Plan Group updated successfully.",
//       data: responseData,
//     });
//   } catch (error) {
//     console.error("❌ Update error:", error);
//     await logActivity(
//       req,
//       PANEL,
//       MODULE,
//       "update",
//       {
//         oneLineMessage: error.message,
//       },
//       false
//     );

//     return res.status(500).json({
//       status: false,
//       message: "Failed to update Session Plan Group. Please try again later.",
//     });
//   }
// };
// exports.updateSessionPlanGroup = async (req, res) => {
//   const { id } = req.params;
//   const formData = req.body;
//   const adminId = req.admin?.id;
//   const files = req.files || {};

//   if (!adminId) {
//     return res.status(401).json({
//       status: false,
//       message: "Unauthorized: Admin ID not found.",
//     });
//   }

//   if (DEBUG) {
//     console.log("🛠️ STEP 1: Updating Session Plan Group ID:", id);
//     console.log("📥 Received Update FormData:", formData);
//     console.log("📎 Uploaded Files:", Object.keys(files));
//   }

//   try {
//     // STEP 2: Fetch existing group
//     const existingResult =
//       await SessionPlanGroupService.getSessionPlanGroupById(id, adminId);
//     if (!existingResult.status || !existingResult.data) {
//       return res.status(404).json({
//         status: false,
//         message: existingResult.message || "Session Plan Group not found.",
//       });
//     }
//     const existing = existingResult.data;

//     // STEP 3: Parse levels JSON safely
//     let parsedLevels = {};
//     if (formData.levels) {
//       try {
//         parsedLevels =
//           typeof formData.levels === "string"
//             ? JSON.parse(formData.levels)
//             : formData.levels;
//       } catch {
//         return res
//           .status(400)
//           .json({ status: false, message: "Invalid JSON format for levels" });
//       }

//       const levelError = validateLevels(parsedLevels);
//       if (levelError)
//         return res.status(400).json({ status: false, message: levelError });
//     }

//     // STEP 4: Handle banner & video uploads
//     const baseUploadDir = path.join(
//       process.cwd(),
//       "uploads",
//       "temp",
//       "admin",
//       `${adminId}`,
//       "session-plan-group"
//     );

//     const saveAndUploadFile = async (file, type, oldPath) => {
//       if (!file) return oldPath || null;

//       const uniqueId = Math.floor(Math.random() * 1e9);
//       const ext = path.extname(file.originalname).toLowerCase();
//       const fileName = `${Date.now()}_${uniqueId}${ext}`;
//       const localPath = path.join(baseUploadDir, type, fileName);

//       await fs.promises.mkdir(path.dirname(localPath), { recursive: true });
//       await saveFile(file, localPath);
//       if (DEBUG) console.log(`💾 Saved ${type} locally at:`, localPath);

//       let uploadedPath = null;
//       try {
//         uploadedPath = await uploadToFTP(localPath, fileName);
//         if (DEBUG) console.log(`☁️ Uploaded ${type} to FTP:`, uploadedPath);

//         if (oldPath) await deleteFile(oldPath); // remove old if replaced
//       } catch (err) {
//         console.error(`❌ Failed to upload ${type}:`, err.message);
//         uploadedPath = oldPath || null;
//       } finally {
//         await fs.promises.unlink(localPath).catch(() => {});
//       }

//       return uploadedPath;
//     };

//     // ✅ Accept both "banner"/"video" and "banner_file"/"video_file"
//     const banner =
//       files.banner?.[0] || files.banner_file?.[0]
//         ? await saveAndUploadFile(
//             files.banner?.[0] || files.banner_file?.[0],
//             "banner",
//             existing.banner
//           )
//         : existing.banner || null;

//     const video =
//       files.video?.[0] || files.video_file?.[0]
//         ? await saveAndUploadFile(
//             files.video?.[0] || files.video_file?.[0],
//             "video",
//             existing.video
//           )
//         : existing.video || null;

//     // STEP 5: Build payload
//     // 🔹 Merge levels instead of replacing them all
//     let mergedLevels = existing.levels;

//     if (Object.keys(parsedLevels).length) {
//       mergedLevels = { ...existing.levels }; // clone current

//       for (const [level, sessions] of Object.entries(parsedLevels)) {
//         mergedLevels[level] = sessions; // only overwrite the level provided
//       }
//     }

//     const updatePayload = {
//       groupName: formData.groupName?.trim() || existing.groupName,
//       levels: mergedLevels,
//       player: formData.player || existing.player,
//       banner,
//       video,
//     };

//     // STEP 6: Update DB
//     const updateResult = await SessionPlanGroupService.updateSessionPlanGroup(
//       id,
//       updatePayload,
//       adminId
//     );
//     if (!updateResult.status) {
//       return res.status(500).json({
//         status: false,
//         message: updateResult.message || "Update failed.",
//       });
//     }
//     const updated = updateResult.data;

//     // STEP 7: Add sessionExercises inside levels
//     let cleanLevels =
//       typeof updated.levels === "string"
//         ? JSON.parse(updated.levels)
//         : updated.levels || {};
//     const allIds = [];
//     Object.values(cleanLevels).forEach((arr) =>
//       arr.forEach((e) => e.sessionExerciseId?.forEach((id) => allIds.push(id)))
//     );

//     const exerciseMap = {};
//     if (allIds.length) {
//       const uniqueIds = [...new Set(allIds)];
//       const exercises = await SessionExercise.findAll({
//         where: { id: uniqueIds },
//         raw: true,
//       });
//       exercises.forEach((ex) => (exerciseMap[ex.id] = ex));
//     }

//     for (const level in cleanLevels) {
//       cleanLevels[level] = cleanLevels[level].map((entry) => ({
//         ...entry,
//         sessionExercises: (entry.sessionExerciseId || [])
//           .map((id) => exerciseMap[id])
//           .filter(Boolean),
//       }));
//     }

//     // STEP 8: Final response
//     const responseData = {
//       id: updated.id,
//       groupName: updated.groupName,
//       player: updated.player,
//       sortOrder: updated.sortOrder || 0,
//       status: updated.status || "active",
//       createdAt: updated.createdAt,
//       updatedAt: updated.updatedAt,
//       banner: updated.banner,
//       video: updated.video,
//       levels: cleanLevels,
//     };

//     if (DEBUG) console.log("✅ Update successful:", responseData);

//     await logActivity(
//       req,
//       PANEL,
//       MODULE,
//       "update",
//       { oneLineMessage: `Updated Session Plan Group ID: ${id}` },
//       true
//     );
//     await createNotification(
//       req,
//       "Session Plan Group Updated",
//       `Session Plan Group '${updated.groupName}' was updated by ${
//         req?.admin?.firstName || "Admin"
//       }.`,
//       "System"
//     );

//     return res.status(200).json({
//       status: true,
//       message: "Session Plan Group updated successfully.",
//       data: responseData,
//     });
//   } catch (error) {
//     console.error("❌ Update error:", error);
//     await logActivity(
//       req,
//       PANEL,
//       MODULE,
//       "update",
//       { oneLineMessage: error.message },
//       false
//     );

//     return res.status(500).json({
//       status: false,
//       message: "Failed to update Session Plan Group. Please try again later.",
//     });
//   }
// };
exports.updateSessionPlanGroup = async (req, res) => {
  const { id } = req.params;
  const formData = req.body;
  const adminId = req.admin?.id;
  const files = req.files || {};

  if (!adminId) {
    return res.status(401).json({
      status: false,
      message: "Unauthorized: Admin ID not found.",
    });
  }

  if (DEBUG) {
    console.log("🛠️ STEP 1: Updating Session Plan Group ID:", id);
    console.log("📥 Received Update FormData:", formData);
    console.log("📎 Uploaded Files:", Object.keys(files));
  }

  try {
    // STEP 2: Fetch existing group
    const existingResult =
      await SessionPlanGroupService.getSessionPlanGroupById(id, adminId);
    if (!existingResult.status || !existingResult.data) {
      return res.status(404).json({
        status: false,
        message: existingResult.message || "Session Plan Group not found.",
      });
    }
    const existing = existingResult.data;

    // STEP 3: Parse levels JSON safely
    let parsedLevels = {};
    if (formData.levels) {
      try {
        parsedLevels =
          typeof formData.levels === "string"
            ? JSON.parse(formData.levels)
            : formData.levels;
      } catch {
        return res
          .status(400)
          .json({ status: false, message: "Invalid JSON format for levels" });
      }

      const levelError = validateLevels(parsedLevels);
      if (levelError)
        return res.status(400).json({ status: false, message: levelError });
    }

    // STEP 4: Handle banner & video uploads
    const baseUploadDir = path.join(
      process.cwd(),
      "uploads",
      "temp",
      "admin",
      `${adminId}`,
      "session-plan-group"
    );

    const saveAndUploadFile = async (file, type, oldPath) => {
      if (!file) return oldPath || null;

      const uniqueId = Math.floor(Math.random() * 1e9);
      const ext = path.extname(file.originalname).toLowerCase();
      const fileName = `${Date.now()}_${uniqueId}${ext}`;
      const localPath = path.join(baseUploadDir, type, fileName);

      await fs.promises.mkdir(path.dirname(localPath), { recursive: true });
      await saveFile(file, localPath);
      if (DEBUG) console.log(`💾 Saved ${type} locally at:`, localPath);

      let uploadedPath = null;
      try {
        uploadedPath = await uploadToFTP(localPath, fileName);
        if (DEBUG) console.log(`☁️ Uploaded ${type} to FTP:`, uploadedPath);

        if (oldPath) await deleteFile(oldPath); // remove old if replaced
      } catch (err) {
        console.error(`❌ Failed to upload ${type}:`, err.message);
        uploadedPath = oldPath || null;
      } finally {
        await fs.promises.unlink(localPath).catch(() => {});
      }

      return uploadedPath;
    };

    // ✅ Accept both "banner"/"video" and "banner_file"/"video_file"
    const banner =
      files.banner?.[0] || files.banner_file?.[0]
        ? await saveAndUploadFile(
            files.banner?.[0] || files.banner_file?.[0],
            "banner",
            existing.banner
          )
        : existing.banner || null;

    const video =
      files.video?.[0] || files.video_file?.[0]
        ? await saveAndUploadFile(
            files.video?.[0] || files.video_file?.[0],
            "video",
            existing.video
          )
        : existing.video || null;

    // STEP 5: Merge levels instead of replacing them all
    let mergedLevels = existing.levels;

    if (Object.keys(parsedLevels).length) {
      mergedLevels = { ...existing.levels };

      for (const [level, sessions] of Object.entries(parsedLevels)) {
        mergedLevels[level] = sessions; // overwrite only provided level
      }
    }

    // STEP 6: Attach recordings to mergedLevels
    for (const [level, sessions] of Object.entries(mergedLevels)) {
      for (let i = 0; i < sessions.length; i++) {
        const fieldName = `recording_${level}_${i}`;
        const fileArr = files[fieldName];
        if (fileArr && fileArr[0]) {
          try {
            const uploadedRecording = await saveAndUploadFile(
              fileArr[0],
              path.join("recording", level),
              sessions[i].recording // old recording path if exists
            );
            sessions[i].recording = uploadedRecording;
            if (DEBUG)
              console.log(
                `🎙️ Updated recording for ${fieldName}:`,
                uploadedRecording
              );
          } catch (err) {
            console.error(
              `❌ Error updating recording ${fieldName}:`,
              err.message
            );
          }
        }
      }
    }

    const updatePayload = {
      groupName: formData.groupName?.trim() || existing.groupName,
      levels: mergedLevels,
      player: formData.player || existing.player,
      banner,
      video,
    };

    // STEP 7: Update DB
    const updateResult = await SessionPlanGroupService.updateSessionPlanGroup(
      id,
      updatePayload,
      adminId
    );
    if (!updateResult.status) {
      return res.status(500).json({
        status: false,
        message: updateResult.message || "Update failed.",
      });
    }
    const updated = updateResult.data;

    // STEP 8: Add sessionExercises inside levels
    let cleanLevels =
      typeof updated.levels === "string"
        ? JSON.parse(updated.levels)
        : updated.levels || {};
    const allIds = [];
    Object.values(cleanLevels).forEach((arr) =>
      arr.forEach((e) => e.sessionExerciseId?.forEach((id) => allIds.push(id)))
    );

    const exerciseMap = {};
    if (allIds.length) {
      const uniqueIds = [...new Set(allIds)];
      const exercises = await SessionExercise.findAll({
        where: { id: uniqueIds },
        raw: true,
      });
      exercises.forEach((ex) => (exerciseMap[ex.id] = ex));
    }

    for (const level in cleanLevels) {
      cleanLevels[level] = cleanLevels[level].map((entry) => ({
        ...entry,
        sessionExercises: (entry.sessionExerciseId || [])
          .map((id) => exerciseMap[id])
          .filter(Boolean),
      }));
    }

    // STEP 9: Final response
    const responseData = {
      id: updated.id,
      groupName: updated.groupName,
      player: updated.player,
      sortOrder: updated.sortOrder || 0,
      status: updated.status || "active",
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
      banner: updated.banner,
      video: updated.video,
      levels: cleanLevels,
    };

    if (DEBUG) console.log("✅ Update successful:", responseData);

    await logActivity(
      req,
      PANEL,
      MODULE,
      "update",
      { oneLineMessage: `Updated Session Plan Group ID: ${id}` },
      true
    );
    await createNotification(
      req,
      "Session Plan Group Updated",
      `Session Plan Group '${updated.groupName}' was updated by ${
        req?.admin?.firstName || "Admin"
      }.`,
      "System"
    );

    return res.status(200).json({
      status: true,
      message: "Session Plan Group updated successfully.",
      data: responseData,
    });
  } catch (error) {
    console.error("❌ Update error:", error);
    await logActivity(
      req,
      PANEL,
      MODULE,
      "update",
      { oneLineMessage: error.message },
      false
    );

    return res.status(500).json({
      status: false,
      message: "Failed to update Session Plan Group. Please try again later.",
    });
  }
};

// ✅ DELETE Session Plan Group
exports.deleteSessionPlanGroup = async (req, res) => {
  const { id } = req.params;
  const adminId = req.admin?.id; // ✅ GET createdBy from token

  if (DEBUG) console.log(`🗑️ STEP 1: Deleting Session Plan Group ID: ${id}`);

  try {
    // ✅ STEP 2: Check if group exists before deleting (with createdBy)
    const existingResult =
      await SessionPlanGroupService.getSessionPlanGroupById(id, adminId);

    if (!existingResult.status || !existingResult.data) {
      if (DEBUG) console.log("❌ Group not found for deletion:", id);
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

    // ✅ STEP 3: Delete group from DB
    const deleteResult = await SessionPlanGroupService.deleteSessionPlanGroup(
      id,
      adminId
    );

    if (!deleteResult.status) {
      if (DEBUG) console.log("⚠️ Delete failed:", deleteResult.message);
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

    // ✅ STEP 4: Remove uploaded files
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
      `Level '${levelKey}' from Session Plan Group ID ${id} was deleted by ${
        req?.admin?.firstName || "Admin"
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

const path = require("path");
const fs = require("fs");
const os = require("os");
const { uploadToFTP } = require("../../../utils/uploadToFTP");

const { validateFormData } = require("../../../utils/validateFormData");
const { saveFile } = require("../../../utils/fileHandler");
const SessionExerciseService = require("../../../services/admin/sessionPlan/sessionExercise");
const { logActivity } = require("../../../utils/admin/activityLogger");

const {
  createNotification,
} = require("../../../utils/admin/notificationHelper");
const axios = require("axios"); // for downloading files

const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "session-plan-exercise";

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

const saveFileAsNew = async (oldUrl, createdBy, newExerciseId, typeFolder) => {
  if (!oldUrl) return null;

  try {
    // Download the old file to local temp
    const response = await axios.get(oldUrl, { responseType: "arraybuffer" });
    const fileData = response.data;

    const fileName = path.basename(oldUrl);
    const ext = path.extname(fileName);
    const uniqueId = Date.now() + "_" + Math.floor(Math.random() * 1e9);
    const newFileName = `${uniqueId}${ext}`;

    const localTempPath = path.join(
      os.tmpdir(),
      "sessionExerciseDuplicate",
      `${createdBy}`,
      `${newExerciseId}`,
      typeFolder,
      newFileName
    );

    await fs.promises.mkdir(path.dirname(localTempPath), { recursive: true });
    await fs.promises.writeFile(localTempPath, fileData);

    // FTP remote path
    const remoteDir = path.posix.join(
      "temp",
      "admin",
      `${createdBy}`,
      "sessionExercise",
      `${newExerciseId}`,
      typeFolder
    );
    const remoteFilePath = path.posix.join(remoteDir, newFileName);

    const publicUrl = await uploadToFTP(localTempPath, remoteFilePath);

    // Cleanup local temp file
    await fs.promises.unlink(localTempPath).catch(() => { });

    if (DEBUG) console.log(`🔁 Cloned FTP file: ${oldUrl} → ${publicUrl}`);
    return publicUrl;
  } catch (err) {
    if (DEBUG) console.error("❌ FTP duplication failed:", err.message);
    return null;
  }
};

/**
 * Duplicate a Session Exercise including its images on FTP
 */
exports.duplicateSessionExercise = async (req, res) => {
  try {
    const { id } = req.params; // old exercise ID
    const createdBy = req.admin?.id || req.user?.id;
    if (!createdBy) return res.status(403).json({ status: false, message: "Unauthorized request" });

    if (DEBUG) console.log("🔍 Duplicating DB row for exercise ID:", id);

    // STEP 1: Duplicate DB row without files
    const result = await SessionExerciseService.duplicateSessionExercise(id, createdBy);
    if (!result.status) return res.status(404).json({ status: false, message: result.message });

    const exercise = result.data; // new DB row
    const newExerciseId = exercise.id;

    if (DEBUG) console.log(`✅ New exercise created with ID: ${newExerciseId}`);

    // STEP 1a: Fetch old exercise for original files
    // Fetch old exercise
    const oldExerciseResult = await SessionExerciseService.getSessionExerciseById(id, createdBy);
    if (!oldExerciseResult.status) {
      return res.status(404).json({ status: false, message: oldExerciseResult.message });
    }

    // Parse imageUrl from DB
    let oldImageUrls = [];
    if (oldExerciseResult.data.imageUrl) {
      try {
        oldImageUrls = JSON.parse(oldExerciseResult.data.imageUrl);
      } catch (err) {
        console.error("❌ Failed to parse imageUrl JSON:", err);
        oldImageUrls = [];
      }
    }

    if (DEBUG) console.log("📂 Original exercise image URLs:", oldImageUrls);

    // STEP 2: Duplicate files on FTP
    const newImageUrls = [];
    for (const oldUrl of oldImageUrls) {
      const newUrl = await saveFileAsNew(oldUrl, createdBy, newExerciseId, "");
      if (newUrl) newImageUrls.push(newUrl);
    }

    // STEP 3: Update DB row with new file URLs
    await SessionExerciseService.updateSessionExercise(newExerciseId, { imageUrl: newImageUrls }, createdBy);

    if (DEBUG) console.log("✅ DB updated with new file URLs:", newImageUrls);

    // STEP 4: Prepare response
    const responseData = {
      ...exercise,
      imageUrl: newImageUrls,
    };

    return res.status(201).json({
      status: true,
      message: "Session Exercise duplicated successfully.",
      data: responseData,
    });
  } catch (error) {
    console.error("❌ Error in duplicateSessionExercise:", error);
    return res.status(500).json({ status: false, message: "Server error." });
  }
};

exports.createSessionExercise = async (req, res) => {
  try {
    const formData = req.body;
    const files = req.files || [];

    // ✅ Validate files
    const allowedExtensions = ["jpg", "jpeg", "png", "webp"];
    for (const file of files) {
      const ext = path.extname(file.originalname).toLowerCase().slice(1);
      if (!allowedExtensions.includes(ext)) {
        return res.status(400).json({ status: false, message: `Invalid file type: ${file.originalname}` });
      }
    }

    // ✅ Validate formData
    const validation = validateFormData(formData, { requiredFields: ["title"] });
    if (!validation.isValid) {
      return res.status(400).json(validation);
    }

    // STEP 1: Create the exercise first WITHOUT image URLs
    const createResult = await SessionExerciseService.createSessionExercise({
      title: formData.title,
      duration: formData.duration || null,
      description: formData.description || null,
      imageUrl: [], // empty for now
      createdBy: req.admin.id,
    });

    if (!createResult.status) {
      return res.status(500).json({ status: false, message: createResult.message || "Failed to create exercise" });
    }

    const sessionExerciseId = createResult.data.id; // ✅ DB-generated ID

    // STEP 2: Upload files using the DB-generated sessionExerciseId
    let savedImagePaths = [];
    for (const file of files) {
      const uniqueId = Math.floor(Math.random() * 1e9);
      const ext = path.extname(file.originalname).toLowerCase();
      const fileName = `${Date.now()}_${uniqueId}${ext}`;

      const localPath = path.join(
        process.cwd(),
        "uploads",
        "temp",
        "admin",
        `${req.admin.id}`,
        "sessionExercise",
        `${sessionExerciseId}`,
        fileName
      );
      await fs.promises.mkdir(path.dirname(localPath), { recursive: true });
      await saveFile(file, localPath);

      const remotePath = `temp/admin/${req.admin.id}/sessionExercise/${sessionExerciseId}/${fileName}`;
      const publicUrl = await uploadToFTP(localPath, remotePath);

      if (publicUrl) savedImagePaths.push(publicUrl);
      await fs.promises.unlink(localPath).catch(() => {});
    }

    // STEP 3: Update the exercise with the uploaded image URLs
    await SessionExerciseService.updateSessionExercise(sessionExerciseId, { imageUrl: savedImagePaths }, req.admin.id);

    // STEP 4: Fetch updated exercise to return
    const exercise = await SessionExerciseService.getSessionExerciseById(sessionExerciseId, req.admin.id);

    return res.status(201).json({
      status: true,
      message: "Exercise created successfully",
      data: exercise.data,
    });

  } catch (error) {
    console.error("❌ Server error:", error);
    return res.status(500).json({ status: false, message: "Server error." });
  }
};

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

const path = require("path");
const fs = require("fs");
const os = require("os");
const { uploadToFTP } = require("../../../../utils/uploadToFTP");

const { validateFormData } = require("../../../../utils/validateFormData");
const { saveFile } = require("../../../../utils/fileHandler");
const SessionExerciseService = require("../../../../services/admin/holidayCamps/sessionPlan/holidaySessionExercise");
const { logActivity } = require("../../../../utils/admin/activityLogger");
const { getMainSuperAdminOfAdmin } = require("../../../../utils/auth");
const {
  createNotification,
} = require("../../../../utils/admin/notificationHelper");
const axios = require("axios"); // for downloading files

const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "holiday-session-plan-exercise";

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
exports.duplicateHolidaySessionExercise = async (req, res) => {
  try {
    const { id } = req.params; // old exercise ID
    const createdBy = req.admin?.id || req.user?.id;
    if (!createdBy) return res.status(403).json({ status: false, message: "Unauthorized request" });

    if (DEBUG) console.log("🔍 Duplicating DB row for exercise ID:", id);

    // STEP 1: Duplicate DB row without files
    const result = await SessionExerciseService.duplicateHolidaySessionExercise(id, createdBy);
    if (!result.status) return res.status(404).json({ status: false, message: result.message });

    const exercise = result.data; // new DB row
    const newExerciseId = exercise.id;

    if (DEBUG) console.log(`✅ New exercise created with ID: ${newExerciseId}`);

    // STEP 1a: Fetch old exercise for original files
    // Fetch old exercise
    const oldExerciseResult = await SessionExerciseService.getHolidaySessionExerciseById(id, createdBy);
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
    await SessionExerciseService.updateHolidaySessionExercise(newExerciseId, { imageUrl: newImageUrls }, createdBy);

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
    console.error("❌ Error in duplicateHolidaySessionExercise:", error);
    return res.status(500).json({ status: false, message: "Server error." });
  }
};

exports.createHolidaySessionExercise = async (req, res) => {
  try {
    const formData = req.body;
    const files = req.files || [];

    // ✅ Validate files
    const allowedExtensions = ["jpg", "jpeg", "png", "webp", "svg"];
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
    const createResult = await SessionExerciseService.createHolidaySessionExercise({
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
        "holidaySessionExercise",
        `${sessionExerciseId}`,
        fileName
      );
      await fs.promises.mkdir(path.dirname(localPath), { recursive: true });
      await saveFile(file, localPath);

      const remotePath = `temp/admin/${req.admin.id}/holidaySessionExercise/${sessionExerciseId}/${fileName}`;
      const publicUrl = await uploadToFTP(localPath, remotePath);

      if (publicUrl) savedImagePaths.push(publicUrl);
      await fs.promises.unlink(localPath).catch(() => { });
    }

    // STEP 3: Update the exercise with the uploaded image URLs
    await SessionExerciseService.updateHolidaySessionExercise(sessionExerciseId, { imageUrl: savedImagePaths }, req.admin.id);

    // STEP 4: Fetch updated exercise to return
    const exercise = await SessionExerciseService.getHolidaySessionExerciseById(sessionExerciseId, req.admin.id);

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

exports.getHolidaySessionExerciseById = async (req, res) => {
  const { id } = req.params;
  const adminId = req.admin?.id; // get adminId from auth middleware
  const mainSuperAdminResult = await getMainSuperAdminOfAdmin(req.admin.id);
  const superAdminId = mainSuperAdminResult?.superAdmin.id ?? null;
  try {
    const result = await SessionExerciseService.getHolidaySessionExerciseById(
      id,
      superAdminId
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
exports.getAllHolidaySessionExercises = async (req, res) => {
  if (DEBUG) console.log("📥 Fetching all exercises...");

  try {
    const adminId = req.admin.id;
    const mainSuperAdminResult = await getMainSuperAdminOfAdmin(req.admin.id);
    const superAdminId = mainSuperAdminResult?.superAdmin.id ?? null;

    const result = await SessionExerciseService.getAllHolidaySessionExercises(superAdminId);

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

// ✅ Update (aligned with createHolidaySessionExercise)
// exports.updateHolidaySessionExercise = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const adminId = req.admin?.id || req.user?.id;
//     const updates = req.body;
//     const files = req.files || [];

//     if (!adminId) {
//       console.error("❌ Unauthorized request: adminId not found");
//       return res.status(403).json({ status: false, message: "Unauthorized request" });
//     }

//     console.log("🔍 STEP 1: Received update request:", updates);

//     // Normalize files to a flat array
//     let filesArray = [];
//     if (Array.isArray(files)) {
//       filesArray = files;
//     } else {
//       filesArray = Object.values(files).flat();
//     }

//     if (filesArray.length > 0) {
//       console.log("📎 Files uploaded:", filesArray.map(f => f.originalname));
//     }

//     // Validate file extensions
//     const allowedExtensions = ["jpg", "jpeg", "png", "webp"];
//     for (const file of filesArray) {
//       const ext = path.extname(file.originalname).toLowerCase().slice(1);
//       if (!allowedExtensions.includes(ext)) {
//         console.error("❌ Invalid file type:", file.originalname);
//         return res.status(400).json({ status: false, message: `Invalid file type: ${file.originalname}` });
//       }
//     }

//     // ✅ STEP 2: Fetch existing exercise
//     console.log("📌 STEP 2: Fetching existing exercise");
//     const existing = await SessionExerciseService.getHolidaySessionExerciseById(id, adminId);

//     if (!existing.status || !existing.data) {
//       console.warn("⚠️ Exercise not found for ID:", id);
//       return res.status(404).json({ status: false, message: "Exercise not found" });
//     }
//     console.log("✅ STEP 2: Found exercise:", existing.data.title);

//     // ✅ STEP 3: Upload files (if any)
//     const uploadedUrls = [];
//     if (filesArray.length > 0) {
//       const baseUploadDir = path.join(process.cwd(), "uploads", "temp", "admin", `${adminId}`, "sessionExercise", `${id}`);
//       console.log("📂 STEP 3: Base upload directory:", baseUploadDir);

//       for (const file of filesArray) {
//         const uniqueId = Date.now() + "_" + Math.floor(Math.random() * 1e9);
//         const ext = path.extname(file.originalname).toLowerCase();
//         const fileName = `${uniqueId}${ext}`;
//         const localPath = path.join(baseUploadDir, fileName);

//         console.log("📌 STEP 3a: Saving local file:", localPath);
//         await fs.promises.mkdir(path.dirname(localPath), { recursive: true });
//         await saveFile(file, localPath);

//         try {
//           console.log("⬆️ STEP 3b: Uploading to FTP:", localPath);
//           const publicUrl = await uploadToFTP(localPath, fileName);
//           if (publicUrl) {
//             uploadedUrls.push(publicUrl);
//             console.log("✅ STEP 3c: Uploaded successfully:", publicUrl);
//           } else {
//             console.error("❌ STEP 3c: Upload returned null for", localPath);
//           }
//         } catch (err) {
//           console.error("❌ STEP 3b: FTP upload failed for", localPath, err.message);
//         } finally {
//           await fs.promises.unlink(localPath).catch(() => { });
//           console.log("🗑️ STEP 3d: Local temp file deleted:", localPath);
//         }
//       }
//     }

//     // ✅ STEP 4: Decide which images to keep
//     if (uploadedUrls.length) {
//       updates.imageUrl = uploadedUrls;
//       console.log("🖼️ Replacing images with new uploads:", uploadedUrls);
//     } else if (updates.imageUrl === null) {
//       updates.imageUrl = [];
//       console.log("🗑️ Clearing all images");
//     } else {
//       updates.imageUrl = Array.isArray(existing.data.imageUrl)
//         ? existing.data.imageUrl
//         : JSON.parse(existing.data.imageUrl || "[]");
//       console.log("🔄 Keeping existing images:", updates.imageUrl);
//     }

//     updates.updatedBy = adminId;

//     // ✅ STEP 5: Update DB
//     console.log("📌 STEP 5: Updating exercise in DB");
//     const result = await SessionExerciseService.updateHolidaySessionExercise(id, updates, adminId);

//     if (!result.status) {
//       console.error("❌ DB update failed:", result.message);
//       await logActivity(req, PANEL, MODULE, "update", result, false);
//       return res.status(500).json(result);
//     }

//     console.log("✅ STEP 5: Exercise updated in DB");

//     // ✅ STEP 6: Log + Notify
//     console.log("📌 STEP 6: Logging activity and creating notification");
//     await logActivity(req, PANEL, MODULE, "update", result, true);

//     await createNotification(
//       req,
//       "Session Exercise Updated",
//       `Session Exercise '${updates.title || existing.data.title}' was updated by ${req?.admin?.firstName || "Admin"}.`,
//       "System"
//     );
//     console.log("✅ STEP 6: Notification created");

//     // ✅ STEP 7: Respond
//     console.log("📦 STEP 7: Responding with updated exercise");
//     return res.status(200).json({
//       status: true,
//       message: "Exercise updated successfully",
//       data: result.data,
//     });
//   } catch (error) {
//     console.error("❌ STEP 0: Update server error:", error);
//     await logActivity(req, PANEL, MODULE, "update", { oneLineMessage: error.message }, false);
//     return res.status(500).json({ status: false, message: "Server error." });
//   }
// };
// ✅ Update (aligned with createHolidaySessionExercise)
exports.updateHolidaySessionExercise = async (req, res) => {
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
    const existing = await SessionExerciseService.getHolidaySessionExerciseById(id, adminId);

    if (!existing.status || !existing.data) {
      console.warn("⚠️ Exercise not found for ID:", id);
      return res.status(404).json({ status: false, message: "Exercise not found" });
    }
    console.log("✅ STEP 2: Found exercise:", existing.data.title);

    // ✅ STEP 3: Upload files (if any)
    const uploadedUrls = [];
    if (filesArray.length > 0) {
      const baseUploadDir = path.join(process.cwd(), "uploads", "temp", "admin", `${adminId}`, "holidaySessionExercise", `${id}`);
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
          const remotePath = `temp/admin/${adminId}/holidaySessionExercise/${id}/${fileName}`;
          const publicUrl = await uploadToFTP(localPath, remotePath);

          if (publicUrl) {
            uploadedUrls.push(publicUrl);
            console.log("✅ STEP 3c: Uploaded successfully:", publicUrl);
          } else {
            console.error("❌ STEP 3c: Upload returned null for", localPath);
          }
        } catch (err) {
          console.error("❌ STEP 3b: FTP upload failed for", localPath, err.message);
        }
        finally {
          await fs.promises.unlink(localPath).catch(() => { });
          console.log("🗑️ STEP 3d: Local temp file deleted:", localPath);
        }
      }
    }

    // ✅ STEP 4: Decide which images to keep
    // ✅ STEP 4: Decide which images to keep
    const existingImages = Array.isArray(existing.data.imageUrl)
      ? existing.data.imageUrl
      : JSON.parse(existing.data.imageUrl || "[]");

    if (uploadedUrls.length) {
      // Append new uploads to existing images instead of replacing
      updates.imageUrl = [...existingImages, ...uploadedUrls];
      console.log("🖼️ Adding new uploaded images to existing:", updates.imageUrl);
    } else if (updates.imageUrl === null) {
      updates.imageUrl = [];
      console.log("🗑️ Clearing all images");
    } else {
      // Keep existing images if no new upload
      updates.imageUrl = existingImages;
      console.log("🔄 Keeping existing images:", updates.imageUrl);
    }

    // ✅ STEP 5: Update DB
    console.log("📌 STEP 5: Updating exercise in DB");
    const result = await SessionExerciseService.updateHolidaySessionExercise(id, updates, adminId);

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
exports.deleteHolidaySessionExercise = async (req, res) => {
  const { id } = req.params;
  const adminId = req.admin?.id; // ✅ Make sure to get adminId

  try {
    const result = await SessionExerciseService.deleteHolidaySessionExercise(
      id,
      adminId
    );

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
      `Session Exercise was deleted by ${req?.admin?.name || "Admin"}.`,
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

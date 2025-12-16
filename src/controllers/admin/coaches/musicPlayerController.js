const path = require("path");
const fs = require("fs");
const { uploadToFTP } = require("../../../utils/uploadToFTP");
const { saveFile } = require("../../../utils/fileHandler");
const musicPlayerService = require("../../../services/admin/coaches/musicPlayerService");
const { logActivity } = require("../../../utils/admin/activityLogger");
const { createNotification } = require("../../../utils/admin/notificationHelper");
const { getMainSuperAdminOfAdmin } = require("../../../utils/auth");

// Set DEBUG flag
const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "music player";

// Controller to create/upload music
exports.createUploadMusic = async (req, res) => {
  try {
    const files = req.files || [];

    if (files.length === 0) {
      return res.status(400).json({
        status: false,
        message: "No music files uploaded",
      });
    }

    if (DEBUG) console.log(`[${MODULE}] Received files:`, files.length);

    // 1️⃣ Validate files (only mp3 allowed)
    const allowedExtensions = ["mp3"];
    for (const file of files) {
      const ext = path.extname(file.originalname).toLowerCase().slice(1);
      if (!allowedExtensions.includes(ext)) {
        if (DEBUG) console.warn(`[${MODULE}] Invalid file type: ${file.originalname}`);
        return res.status(400).json({
          status: false,
          message: `Invalid file type: ${file.originalname}`,
        });
      }
    }

    if (DEBUG) console.log(`[${MODULE}] All files validated successfully`);

    const createdRecords = [];

    // 2️⃣ Upload each file and save as separate record
    for (const file of files) {
      const uniqueId = Date.now() + "_" + Math.floor(Math.random() * 1e9);
      const ext = path.extname(file.originalname).toLowerCase();
      const fileName = `${uniqueId}${ext}`;

      const localPath = path.join(
        process.cwd(),
        "uploads",
        "temp",
        PANEL,
        "musicPlayer",
        fileName
      );
      await fs.promises.mkdir(path.dirname(localPath), { recursive: true });
      await saveFile(file, localPath);

      const remotePath = `uploads/temp/${PANEL}/${req.admin.id}/musicPlayer/${fileName}`;
      const publicUrl = await uploadToFTP(localPath, remotePath);

      // Cleanup local temp file
      await fs.promises.unlink(localPath).catch(() => { });

      if (!publicUrl) continue;

      if (DEBUG) console.log(`[${MODULE}] Uploaded file:`, publicUrl);

      // Save each file as a separate record
      const createResult = await musicPlayerService.createUploadMusic({
        uploadMusic: publicUrl,
        createdBy: req.admin.id,
      });

      if (createResult.status) createdRecords.push(createResult.data);
    }

    if (createdRecords.length === 0) {
      return res.status(500).json({
        status: false,
        message: "Failed to upload any music files",
      });
    }

    if (DEBUG) console.log(`[${MODULE}] All files saved in DB, total: ${createdRecords.length}`);

    // 3️⃣ Log activity
    await logActivity(
      req,
      PANEL,
      MODULE,
      "create",
      {
        oneLineMessage: `Uploaded ${createdRecords.length} music file(s).`,
      },
      true
    );

    // 4️⃣ Create notification
    const adminFullName = `${req.admin?.firstName || ""} ${req.admin?.lastName || ""}`.trim();
    const notificationMessage = `Uploaded ${createdRecords.length} new music file(s) by ${adminFullName || "Unknown Admin"}`;
    await createNotification(req, "New Music Uploaded", notificationMessage, "Support");

    // 5️⃣ Return response
    return res.status(201).json({
      status: true,
      message: "Music uploaded successfully",
      data: createdRecords,
    });
  } catch (error) {
    if (DEBUG) console.error(`[${MODULE}] Server error:`, error);
    return res.status(500).json({
      status: false,
      message: "Server error while uploading music",
    });
  }
};

exports.getUploadMusic = async (req, res) => {
  try {
    // ✅ Get super admin for access control
    const mainSuperAdminResult = await getMainSuperAdminOfAdmin(req.admin?.id);
    const superAdminId = mainSuperAdminResult?.superAdmin?.id ?? null;

    if (DEBUG) console.log(`🧩 SuperAdminId resolved as: ${superAdminId}`);

    // Fetch music records from service
    const result = await musicPlayerService.getUploadMusic(superAdminId);

    if (!result.status) {
      if (DEBUG) console.error(`[${MODULE}] Failed to fetch music list`);
      return res.status(500).json({
        status: false,
        message: result.message,
      });
    }

    if (DEBUG) console.log(`[${MODULE}] Fetched ${result.data.length} music records`);

    // ✅ Log activity
    await logActivity(
      req,
      PANEL,
      MODULE,
      "view",
      { oneLineMessage: `Viewed music list, total ${result.data.length} records.` },
      true
    );

    // ✅ Return response
    return res.status(200).json({
      status: true,
      message: "Music list fetched successfully.",
      data: result.data,
    });
  } catch (error) {
    if (DEBUG) console.error(`[${MODULE}] Server error in listUploadMusic:`, error);
    return res.status(500).json({
      status: false,
      message: "Server error while fetching music list.",
    });
  }
};

exports.getUploadMusicById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      if (DEBUG) console.warn(`[${MODULE}] Music ID not provided`);
      return res.status(400).json({
        status: false,
        message: "Music ID is required.",
      });
    }

    // ✅ Get super admin for access control
    const mainSuperAdminResult = await getMainSuperAdminOfAdmin(req.admin?.id);
    const superAdminId = mainSuperAdminResult?.superAdmin?.id ?? null;

    if (DEBUG) console.log(`🧩 SuperAdminId resolved as: ${superAdminId}`);

    // Fetch single music record from service
    const result = await musicPlayerService.getUploadMusicById(id);

    if (!result.status) {
      if (DEBUG) console.error(`[${MODULE}] Failed to fetch music record`);
      return res.status(404).json({
        status: false,
        message: result.message,
      });
    }

    if (DEBUG) console.log(`[${MODULE}] Fetched music record with ID: ${id}`);

    // ✅ Log activity
    await logActivity(
      req,
      PANEL,
      MODULE,
      "view",
      { oneLineMessage: `Viewed music record with ID: ${id}.` },
      true
    );

    // ✅ Return response
    return res.status(200).json({
      status: true,
      message: "Music record fetched successfully.",
      data: result.data,
    });
  } catch (error) {
    if (DEBUG) console.error(`[${MODULE}] Server error in getUploadMusicById:`, error);
    return res.status(500).json({
      status: false,
      message: "Server error while fetching music record.",
    });
  }
};

exports.renameMusicTrack = async (req, res) => {
  try {
    const { id } = req.params;
    const { fileName } = req.body;

    if (!fileName || !fileName.trim()) {
      return res.status(400).json({
        status: false,
        message: "fileName is required",
      });
    }

    const result = await musicPlayerService.renameMusicFile(id, fileName);

    if (!result.status) {
      return res.status(400).json(result);
    }

    // ✅ Log Activity (EDIT TRACK)
    await logActivity(
      req,
      PANEL,
      MODULE,
      "update",
      {
        oneLineMessage: `Renamed music track (ID: ${id})`,
        metaData: {
          musicId: id,
          newFileName: result.data.uploadMusic,
        },
      },
      true
    );

    if (DEBUG) {
      console.log(`[${MODULE}] Track renamed:`, result.data.uploadMusic);
    }

    return res.status(200).json({
      status: true,
      message: "Track renamed successfully",
      data: result.data,
    });
  } catch (error) {
    console.error(`[${MODULE}] Rename error:`, error);
    return res.status(500).json({
      status: false,
      message: "Server error while renaming track",
    });
  }
};

exports.deleteUploadMusic = async (req, res) => {
  try {
    const { id } = req.params;

    if (DEBUG) {
      console.log(`[${MODULE}] Delete request received for ID:`, id);
    }

    // 🔐 Resolve super admin (for access control only)
    const mainSuperAdminResult = await getMainSuperAdminOfAdmin(req.admin?.id);
    const superAdminId = mainSuperAdminResult?.superAdmin?.id ?? null;

    if (DEBUG) {
      console.log(`🧩 SuperAdminId resolved as: ${superAdminId}`);
    }

    // ✅ Pass ACTUAL admin who performed delete
    const result = await musicPlayerService.deleteMusicFile(
      id,
      req.admin.id
    );

    if (!result.status) {
      if (DEBUG) {
        console.warn(`[${MODULE}] Delete failed:`, result.message);
      }
      return res.status(404).json(result);
    }

    // 🧾 Activity log
    await logActivity(
      req,
      PANEL,
      MODULE,
      "delete",
      {
        oneLineMessage: `Deleted music track (ID: ${id})`,
      },
      true
    );

    if (DEBUG) {
      console.log(`[${MODULE}] Music deleted successfully for ID:`, id);
    }

    return res.status(200).json({
      status: true,
      message: "Music deleted successfully",
    });
  } catch (error) {
    console.error(`[${MODULE}] Delete controller error:`, error);
    return res.status(500).json({
      status: false,
      message: "Server error while deleting music",
    });
  }
};

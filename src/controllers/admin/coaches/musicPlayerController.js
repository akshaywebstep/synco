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
    const musicFiles = req.files?.uploadMusic || [];
    const imageFile = req.files?.musicImage?.[0] || null;

    if (musicFiles.length === 0) {
      return res.status(400).json({
        status: false,
        message: "No music files uploaded",
      });
    }

    // =========================
    // 1️⃣ Validate music files
    // =========================
    const allowedMusicExtensions = ["mp3"];

    for (const file of musicFiles) {
      const ext = path.extname(file.originalname).toLowerCase().slice(1);
      if (!allowedMusicExtensions.includes(ext)) {
        return res.status(400).json({
          status: false,
          message: `Invalid music file: ${file.originalname}`,
        });
      }
    }

    // =========================
    // 2️⃣ Validate image (optional)
    // =========================
    let imagePublicUrl = null;

    if (imageFile) {
      const allowedImageExtensions = ["jpg", "jpeg", "png", "webp"];
      const imgExt = path.extname(imageFile.originalname).toLowerCase().slice(1);

      if (!allowedImageExtensions.includes(imgExt)) {
        return res.status(400).json({
          status: false,
          message: "Invalid image format",
        });
      }

      const imageFileName = imageFile.originalname; // 🔥 keep original name

      const imageLocalPath = path.join(
        process.cwd(),
        "uploads",
        "temp",
        PANEL,
        "musicPlayer",
        "images",
        imageFileName
      );

      await fs.promises.mkdir(path.dirname(imageLocalPath), { recursive: true });
      await saveFile(imageFile, imageLocalPath);

      const imageRemotePath = `uploads/temp/${PANEL}/${req.admin.id}/musicPlayer/images/${imageFileName}`;
      imagePublicUrl = await uploadToFTP(imageLocalPath, imageRemotePath);

      await fs.promises.unlink(imageLocalPath).catch(() => { });
    }

    // =========================
    // 3️⃣ Upload music files
    // =========================
    const createdRecords = [];

    for (const file of musicFiles) {
      const musicFileName = file.originalname; // 🔥 ORIGINAL FILE NAME

      const musicLocalPath = path.join(
        process.cwd(),
        "uploads",
        "temp",
        PANEL,
        "musicPlayer",
        "music",
        musicFileName
      );

      await fs.promises.mkdir(path.dirname(musicLocalPath), { recursive: true });
      await saveFile(file, musicLocalPath);

      const musicRemotePath = `uploads/temp/${PANEL}/${req.admin.id}/musicPlayer/music/${musicFileName}`;
      const musicPublicUrl = await uploadToFTP(musicLocalPath, musicRemotePath);

      await fs.promises.unlink(musicLocalPath).catch(() => { });

      if (!musicPublicUrl) continue;

      const createResult = await musicPlayerService.createUploadMusic({
        uploadMusic: musicPublicUrl,
        musicImage: imagePublicUrl, // 🔥 SAME image for all tracks
        createdBy: req.admin.id,
      });

      if (createResult.status) createdRecords.push(createResult.data);
    }

    if (!createdRecords.length) {
      return res.status(500).json({
        status: false,
        message: "Failed to upload music",
      });
    }

    // =========================
    // 4️⃣ Response
    // =========================
    return res.status(201).json({
      status: true,
      message: "Music & image uploaded successfully",
      data: createdRecords,
    });

  } catch (error) {
    console.error(`[${MODULE}] Error:`, error);
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
    const result = await musicPlayerService.getUploadMusic(superAdminId, req.admin.id);

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
    const result = await musicPlayerService.getUploadMusicById(id, req.admin.id, superAdminId);

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

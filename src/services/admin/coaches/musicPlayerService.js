const {
  Admin,
  MusicPlayer,
} = require("../../../models");
const DEBUG = process.env.DEBUG === "true";
const mm = require('music-metadata');
const path = require('path');
const { getVideoDurationInSeconds, formatDuration } = require("../../../utils/videoHelper"); // adjust path
const { Op } = require("sequelize");
const { renameOnFTP, deleteFromFTP } = require("../../../utils/uploadToFTP");
const fs = require("fs");
// Create admin
exports.createUploadMusic = async (data) => {
  try {
    const uploadMusic = await MusicPlayer.create(data);

    return {
      status: true,
      message: "Music Uploaded successfully.",
      data: uploadMusic,
    };
  } catch (error) {
    console.error("❌ Sequelize Error in createUploadMusic:", error);

    return {
      status: false,
      message:
        error?.parent?.sqlMessage ||
        error?.message ||
        "Failed to createUploadMusic.",
    };
  }
};

// Fetch all music records

exports.getUploadMusic = async (adminId, superAdminId) => {
  try {
    // 1️⃣ Validate adminId
    // -----------------------------
    if (!adminId || isNaN(Number(adminId))) {
      return {
        status: false,
        message: "No valid admin ID found for this request.",
        data: [],
      };
    }

    // -----------------------------
    // 2️⃣ Build WHERE condition
    // -----------------------------
    const whereCondition = {};
    let allowedAdminIds = [];

    if (superAdminId && superAdminId === adminId) {
      // 🟢 Super Admin → fetch all admins under them + self
      const managedAdmins = await Admin.findAll({
        where: { superAdminId },
        attributes: ["id"],
      });

      const adminIds = managedAdmins.map((a) => a.id);
      adminIds.push(superAdminId);

      allowedAdminIds = adminIds;
      whereCondition.createdBy = { [Op.in]: adminIds };

    } else if (superAdminId && adminId) {
      // 🟢 Admin → own + super admin contracts
      allowedAdminIds = [adminId, superAdminId];
      whereCondition.createdBy = { [Op.in]: allowedAdminIds };

    } else {
      // 🟢 Fallback → only own contracts
      allowedAdminIds = [adminId];
      whereCondition.createdBy = adminId;
    }
    const musicRecords = await MusicPlayer.findAll({
      where: whereCondition,
      order: [["createdAt", "DESC"]],
    });

    const recordsWithDuration = await Promise.all(
      musicRecords.map(async (record) => {
        const fileUrl = record.uploadMusic; // single file
        const durationSeconds = await getVideoDurationInSeconds(fileUrl);

        return {
          id: record.id,
          createdBy: record.createdBy,
          uploadMusic: fileUrl,
          durationSeconds,
          durationFormatted: formatDuration(durationSeconds),
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
        };
      })
    );

    if (DEBUG) console.log(`Music list fetched, total records: ${recordsWithDuration.length}`);

    return {
      status: true,
      message: "Music list fetched successfully.",
      data: recordsWithDuration,
    };
  } catch (error) {
    console.error("❌ Sequelize Error in getUploadMusic:", error);
    return {
      status: false,
      message: error?.parent?.sqlMessage || error?.message || "Failed to fetch music list.",
    };
  }
};

exports.getUploadMusicById = async (id, adminId, superAdminId) => {
  try {
    // 1️⃣ Validate adminId
    // -----------------------------
    if (!adminId || isNaN(Number(adminId))) {
      return {
        status: false,
        message: "No valid admin ID found for this request.",
        data: [],
      };
    }

    // -----------------------------
    // 2️⃣ Build WHERE condition
    // -----------------------------
    const whereCondition = {};
    let allowedAdminIds = [];

    if (superAdminId && superAdminId === adminId) {
      // 🟢 Super Admin → fetch all admins under them + self
      const managedAdmins = await Admin.findAll({
        where: { superAdminId },
        attributes: ["id"],
      });

      const adminIds = managedAdmins.map((a) => a.id);
      adminIds.push(superAdminId);

      allowedAdminIds = adminIds;
      whereCondition.createdBy = { [Op.in]: adminIds };

    } else if (superAdminId && adminId) {
      // 🟢 Admin → own + super admin contracts
      allowedAdminIds = [adminId, superAdminId];
      whereCondition.createdBy = { [Op.in]: allowedAdminIds };

    } else {
      // 🟢 Fallback → only own contracts
      allowedAdminIds = [adminId];
      whereCondition.createdBy = adminId;
    }

    // Fetch single music record by ID
    const record = await MusicPlayer.findOne({
      where: {
        id,
        ...whereCondition,
      },
    });

    if (!record) {
      return {
        status: false,
        message: "Music record not found.",
      };
    }

    const fileUrl = record.uploadMusic; // single file
    const durationSeconds = await getVideoDurationInSeconds(fileUrl);

    const parsedRecord = {
      id: record.id,
      createdBy: record.createdBy,
      uploadMusic: fileUrl,
      durationSeconds,
      durationFormatted: formatDuration(durationSeconds),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };

    if (DEBUG) console.log("Music record fetched:", parsedRecord);

    return {
      status: true,
      message: "Music record fetched successfully.",
      data: parsedRecord,
    };
  } catch (error) {
    console.error("❌ Sequelize Error in getUploadMusicById:", error);
    return {
      status: false,
      message: error?.parent?.sqlMessage || error?.message || "Failed to fetch music record.",
    };
  }
};

exports.renameMusicFile = async (id, newFileName) => {
  try {
    const record = await MusicPlayer.findByPk(id);
    if (!record) {
      return { status: false, message: "Music record not found." };
    }

    // ✅ Sanitize title → filename
    let safeName = newFileName
      .toLowerCase()
      .replace(/[^a-z0-9-_ ]/gi, "")
      .replace(/\s+/g, "-");

    if (!safeName.endsWith(".mp3")) {
      safeName += ".mp3";
    }

    // ✅ PURE FTP RENAME (URL + filename only)
    const newPublicUrl = await renameOnFTP(
      record.uploadMusic, // full URL
      safeName             // filename only
    );

    // ✅ Update DB
    record.uploadMusic = newPublicUrl;
    await record.save();

    return {
      status: true,
      message: "Track renamed successfully",
      data: {
        id: record.id,
        uploadMusic: record.uploadMusic,
        updatedAt: record.updatedAt,
      },
    };
  } catch (error) {
    console.error("❌ FTP rename error:", error);
    return {
      status: false,
      message: "Failed to rename track",
    };
  }
};

exports.deleteMusicFile = async (id, adminId) => {
  try {
    const record = await MusicPlayer.findByPk(id);
    if (!record) {
      return { status: false, message: "Music record not found." };
    }

    // 🗑️ Delete from FTP first
    await deleteFromFTP(record.uploadMusic);

    // ✅ Save deletedBy + soft delete
    await record.update({ deletedBy: adminId });
    await record.destroy(); // paranoid → sets deletedAt

    return {
      status: true,
      message: "Music file deleted successfully",
      data: {
        id: record.id,
        deletedBy: adminId,
      },
    };
  } catch (error) {
    console.error("❌ FTP delete error:", error);
    return {
      status: false,
      message: "Failed to delete music file",
    };
  }
};
const path = require("path");
const fs = require("fs");
const uploadToFTP = require("../../../utils/uploadToFTP");

const { validateFormData } = require("../../../utils/validateFormData");
const { saveFile } = require("../../../utils/fileHandler");
const SessionExerciseService = require("../../../services/admin/sessionPlan/sessionExercise");
const { logActivity } = require("../../../utils/admin/activityLogger");

const {
  createNotification,
} = require("../../../utils/admin/notificationHelper");

const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "session-plan-exercise";

// ✅ Create Session Exercise (refined single-step)
exports.createSessionExercise = async (req, res) => {
  try {
    const formData = req.body;
    const files = req.files || [];

    if (DEBUG) {
      console.log("📥 Create Exercise:", formData);
      if (files.length) {
        files.forEach((f) => console.log("📎 File uploaded:", f.originalname));
      }
    }

    // ✅ Validate file extensions
    const allowedExtensions = ["jpg", "jpeg", "png", "webp"];
    for (const file of files) {
      const ext = path.extname(file.originalname).toLowerCase().slice(1);
      if (!allowedExtensions.includes(ext)) {
        return res.status(400).json({
          status: false,
          message: `Invalid file type: ${file.originalname}`,
        });
      }
    }

    // ✅ Validate required fields
    const validation = validateFormData(formData, {
      requiredFields: ["title"],
    });

    if (!validation.isValid) {
      await logActivity(req, PANEL, MODULE, "create", validation.error, false);
      return res.status(400).json(validation);
    }

    // ✅ STEP 1: Upload files first
    // let savedImagePaths = [];
    // if (files.length > 0) {
    //   for (const file of files) {
    //     const uniqueId = Math.floor(Math.random() * 1e9);
    //     const ext = path.extname(file.originalname).toLowerCase();
    //     const fileName = `${Date.now()}_${uniqueId}${ext}`;
    //     const localPath = path.join(
    //       process.cwd(),
    //       "uploads",
    //       "temp",
    //       "admin",
    //       `${req.admin.id}`, // use admin id folder (or sessionPlan id if needed later)
    //       "sessionExercise",
    //       fileName
    //     );

    //     await fs.promises.mkdir(path.dirname(localPath), { recursive: true });
    //     await saveFile(file, localPath);

    //     try {
    //       // Upload to FTP
    //       const savedPath = await uploadToFTP(localPath, fileName);
    //       console.log("✅ Uploaded to FTP:", savedPath);
    //       savedImagePaths.push(savedPath);
    //     } catch (err) {
    //       console.error("❌ FTP upload failed:", err.message);
    //     } finally {
    //       // Clean local temp
    //       await fs.promises.unlink(localPath).catch(() => {});
    //     }
    //   }
    // }
    let savedImagePaths = [];
if (files.length > 0) {
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
      fileName
    );

    await fs.promises.mkdir(path.dirname(localPath), { recursive: true });
    await saveFile(file, localPath);

    try {
      // Upload to FTP and get public URL
      const publicUrl = await uploadToFTP(localPath, fileName);
      if (DEBUG) console.log("✅ Uploaded to FTP, Public URL:", publicUrl);
      if (publicUrl) savedImagePaths.push(publicUrl); // save URL in DB
    } catch (err) {
      console.error("❌ FTP upload failed:", err.message);
    } finally {
      // Remove local temp file
      await fs.promises.unlink(localPath).catch(() => {});
    }
  }
}

    // ✅ STEP 2: Create exercise with final image array
    const createResult = await SessionExerciseService.createSessionExercise({
      title: formData.title,
      duration: formData.duration || null,
      description: formData.description || null,
      imageUrl: savedImagePaths, // already uploaded
      createdBy: req.admin.id,
    });

    if (!createResult.status) {
      await logActivity(req, PANEL, MODULE, "create", createResult, false);
      return res.status(500).json({
        status: false,
        message: createResult.message || "Failed to create exercise",
      });
    }

    const exercise = createResult.data;

    // ✅ STEP 3: Log + notify
    await logActivity(req, PANEL, MODULE, "create", createResult, true);
    await createNotification(
      req,
      "New Session Exercise Created",
      `Session Exercise '${formData.title}' was created by ${
        req?.admin?.firstName || "Admin"
      }.`,
      "System"
    );

    return res.status(201).json({
      status: true,
      message: "Exercise created successfully",
      data: exercise,
    });
  } catch (error) {
    console.error("❌ Server error:", error);
    await logActivity(
      req,
      PANEL,
      MODULE,
      "create",
      { oneLineMessage: error.message },
      false
    );
    return res.status(500).json({ status: false, message: "Server error." });
  }
};

// ✅ Get By ID
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
        oneLineMessage: `Fetched ${
          result.data.length || 0
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

// ✅ Update
exports.updateSessionExercise = async (req, res) => {
  const { id } = req.params;
  const adminId = req.admin?.id;
  const updates = req.body;
  const files = req.files || [];

  if (!adminId) {
    return res.status(403).json({
      status: false,
      message: "Admin ID missing or unauthorized",
    });
  }

  if (DEBUG)
    console.log(
      "📤 Update Exercise Request:",
      updates,
      "Files:",
      files.map((f) => f.originalname)
    );

  try {
    let savedImagePaths = [];

    // ✅ STEP 1: Handle uploaded files
    if (files.length > 0) {
      for (const file of files) {
        const ext = path.extname(file.originalname).toLowerCase();
        const uniqueId = Math.floor(Math.random() * 1e9);
        const fileName = `${Date.now()}_${uniqueId}${ext}`;
        const localPath = path.join(
          process.cwd(),
          "uploads",
          "temp",
          "admin",
          `${id}`,
          "sessionExercise",
          fileName
        );

        await fs.promises.mkdir(path.dirname(localPath), { recursive: true });

        if (DEBUG) console.log("💾 Saving local file:", localPath);
        await saveFile(file, localPath);

        try {
          const savedPath = await uploadToFTP(localPath, fileName);
          if (DEBUG) console.log("✅ Uploaded to FTP:", savedPath);
          savedImagePaths.push(savedPath);
        } catch (err) {
          console.error("❌ FTP upload failed:", err.message);
        } finally {
          await fs.promises.unlink(localPath).catch(() => {});
          if (DEBUG) console.log("🗑️ Deleted local temp file:", localPath);
        }
      }
    }

    // ✅ STEP 2: Fetch existing exercise
    const existing = await SessionExerciseService.getSessionExerciseById(
      id,
      adminId
    );
    if (DEBUG) console.log("🔍 Existing Exercise:", existing);

    if (!existing.status || !existing.data) {
      if (DEBUG) console.warn("⚠️ Exercise not found for ID:", id);
      return res
        .status(404)
        .json({ status: false, message: "Exercise not found" });
    }

    // ✅ STEP 3: Replace images if new files uploaded, else keep existing
    if (savedImagePaths.length) {
      updates.imageUrl = savedImagePaths;
      if (DEBUG) console.log("🖼️ Replacing images with:", savedImagePaths);
    } else if (updates.imageUrl === null) {
      updates.imageUrl = [];
      if (DEBUG) console.log("🗑️ Clearing all images");
    } else {
      updates.imageUrl = Array.isArray(existing.data.imageUrl)
        ? existing.data.imageUrl
        : JSON.parse(existing.data.imageUrl || "[]");
      if (DEBUG) console.log("🔄 Keeping existing images:", updates.imageUrl);
    }

    updates.updatedBy = adminId;

    // ✅ STEP 4: Update DB
    const result = await SessionExerciseService.updateSessionExercise(
      id,
      updates,
      adminId
    );
    if (DEBUG) console.log("📝 Update Result:", result);

    if (!result.status) {
      await logActivity(req, PANEL, MODULE, "update", result, false);
      return res.status(500).json(result);
    }

    // ✅ STEP 5: Log + Notify
    await logActivity(req, PANEL, MODULE, "update", result, true);

    await createNotification(
      req,
      "Session Exercise Updated",
      `Session Exercise '${
        updates.title || existing.data.title
      }' was updated by ${req?.admin?.firstName || "Admin"}.`,
      "System"
    );

    if (DEBUG) console.log("✅ Exercise updated successfully");

    return res.status(200).json({
      status: true,
      message: "Exercise updated successfully",
      data: result.data,
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
      `Session Exercise ID '${id}' was deleted by ${
        req?.admin?.name || "Admin"
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

const { validateFormData } = require("../../../utils/validateFormData");
const { logActivity } = require("../../../utils/admin/activityLogger");
const { createNotification } = require("../../../utils/admin/notificationHelper");
const { getMainSuperAdminOfAdmin } = require("../../../utils/auth");
const ToDoService = require("../../../services/admin/toDoList/toDoService");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { uploadToFTP } = require("../../../utils/uploadToFTP");
const { saveFile } = require("../../../utils/fileHandler");

const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "to-do";

// CREATE TASK WITH FTP FILE UPLOAD
exports.createTask = async (req, res) => {
  try {
    const { title, description, assignedAdmins, status, comment, priority } = req.body;
    const files = req.files || [];
    const adminId = req.admin.id;

    let uploadedUrls = [];

    // ============================
    // 1️⃣ VALIDATIONS
    // ============================
    if (!title || !description) {
      return res.status(400).json({
        status: false,
        message: "Title & description are required",
      });
    }

    // ----------------------------
    // Validate assignedAdmins
    // ----------------------------

    let assignedAdminsArray = [];

    if (assignedAdmins !== undefined && assignedAdmins !== null && assignedAdmins !== "") {
      try {
        // Convert string → array if needed
        assignedAdminsArray =
          typeof assignedAdmins === "string"
            ? JSON.parse(assignedAdmins)
            : assignedAdmins;

        if (!Array.isArray(assignedAdminsArray)) {
          return res.status(400).json({
            status: false,
            message: "assignedAdmins must be an array",
          });
        }

        // Must contain only numeric IDs
        const invalid = assignedAdminsArray.some(id => isNaN(Number(id)));
        if (invalid) {
          return res.status(400).json({
            status: false,
            message: "assignedAdmins must contain only numeric admin IDs",
          });
        }
      } catch (err) {
        return res.status(400).json({
          status: false,
          message: "assignedAdmins must be a valid JSON array",
        });
      }
    }

    if (
      assignedAdmins === undefined ||
      assignedAdmins === null ||
      assignedAdmins === "[]"
    ) {
      return res.status(400).json({
        status: false,
        message: "Assign members are required",
      });
    }
    // ----------------------------
    // Normalize Multer files → array
    // ----------------------------
    let filesArray = [];

    if (Array.isArray(files)) {
      filesArray = files;
    } else if (typeof files === "object") {
      filesArray = Object.values(files).flat();
    }

    // ----------------------------
    // Validate attachments exist
    // ----------------------------
    if (filesArray.length === 0) {
      return res.status(400).json({
        status: false,
        message: "At least one attachment is required",
      });
    }
    // Validate file types
    const allowedExtensions = [ // Images
      "jpg", "jpeg", "png", "webp", "gif", "bmp", "svg", "tiff",

      // Documents
      "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "csv",
      "txt", "rtf", "odt",

      // Code/Text
      "json", "xml", "html", "md",

      // Videos
      "mp4", "mov", "avi", "mkv", "webm",

      // Audio
      "mp3", "wav", "aac", "flac", "ogg",

      // Compressed
      "zip", "rar", "7z", "tar", "gz"];
    for (const file of filesArray) {
      const ext = path.extname(file.originalname).toLowerCase().slice(1);
      if (!allowedExtensions.includes(ext)) {
        return res.status(400).json({ status: false, message: `Invalid file type: ${file.originalname}` });
      }
    }

    // ============================
    // 2️⃣ UPLOAD FILES TO FTP
    // ============================
    for (const file of filesArray) {
      const uniqueId = Date.now() + "_" + Math.floor(Math.random() * 1e9);
      const ext = path.extname(file.originalname).toLowerCase();
      const fileName = `${uniqueId}${ext}`;

      const localPath = path.join(
        process.cwd(),
        "uploads",
        "temp",
        "admin",
        `${adminId}`,
        "todo",
        fileName
      );

      // Save temporary
      await fs.promises.mkdir(path.dirname(localPath), { recursive: true });
      await saveFile(file, localPath);

      try {
        const remotePath = `uploads/temp/admin/${adminId}/todo/${fileName}`;
        const publicUrl = await uploadToFTP(localPath, remotePath);

        if (publicUrl) {
          uploadedUrls.push(publicUrl);
        }
      } finally {
        // Remove temp file
        await fs.promises.unlink(localPath).catch(() => { });
      }
    }

    // ============================
    // 3️⃣ CONVERT URLS → [{ url }]
    // ============================
    const formattedAttachments = uploadedUrls.map(url => ({ url }));

    // ============================
    // 4️⃣ SAVE TASK TO DB
    // ============================
    const result = await ToDoService.createTask({
      title,
      description,
      attachments: JSON.stringify(formattedAttachments),
      assignedAdmins: assignedAdmins || null,
      status,
      priority,
      comment,
      createdBy: adminId,
    });

    if (!result.status) {
      return res.status(500).json({ status: false, message: result.message });
    }

    return res.status(201).json({
      status: true,
      message: "Task created successfully",
      data: result.data,
    });

  } catch (err) {
    console.error("❌ createTask Error:", err);
    return res.status(500).json({ status: false, message: "Server error" });
  }
};

// ✅ CREATE TASK
// exports.createTask = async (req, res) => {
//   const { title, description, attachments, assignedAdmins, status,comment, priority } = req.body;

//   const validation = validateFormData(req.body, {
//     requiredFields: ["title", "description"],
//   });

//   if (!validation.isValid) {
//     await logActivity(req, PANEL, MODULE, "create", { message: validation.error }, false);
//     return res.status(400).json({ status: false, message: validation.error });
//   }

//   try {
//     const result = await ToDoService.createTask({
//       title,
//       description,
//       attachments: attachments || null,
//       assignedAdmins: assignedAdmins || null,
//       status,
//       priority,
//       comment,
//       createdBy: req.admin.id,
//     });

//     if (!result.status) {
//       await logActivity(req, PANEL, MODULE, "create", { message: result.message }, false);
//       return res.status(500).json({ status: false, message: result.message });
//     }

//     await logActivity(req, PANEL, MODULE, "create", { message: "Created successfully" }, true);

//     const adminFullName = req.admin?.name || "Unknown Admin";
//     await createNotification(req, "Task Created", `New task added by ${adminFullName}`, "Support");

//     return res.status(201).json({ status: true, message: "Task created successfully", data: result.data });

//   } catch (error) {
//     console.error("❌ createTask controller Error:", error);
//     await logActivity(req, PANEL, MODULE, "create", { message: error.message }, false);
//     return res.status(500).json({ status: false, message: "Server error" });
//   }
// };

// ✅ LIST TASKS (By Super Admin)
exports.listTasks = async (req, res) => {
  const mainSuperAdminResult = await getMainSuperAdminOfAdmin(req.admin.id);
  const superAdminId = mainSuperAdminResult?.superAdmin?.id ?? null;

  const result = await ToDoService.listTasks(superAdminId);

  if (!result.status) {
    await logActivity(req, PANEL, MODULE, "list", { message: result.message }, false);
    return res.status(500).json({ status: false, message: result.message });
  }

  await logActivity(req, PANEL, MODULE, "list", { message: "Fetched successfully" }, true);
  return res.status(200).json({ status: true, data: result.data });
};

// ✅ GET ONE TASK
exports.getTaskById = async (req, res) => {
  const { id } = req.params;
  const result = await ToDoService.getTaskById(id);

  if (!result.status) {
    await logActivity(req, PANEL, MODULE, "view-one", { message: result.message }, false);
    return res.status(404).json({ status: false, message: result.message });
  }

  await logActivity(req, PANEL, MODULE, "view-one", { message: "Fetched successfully" }, true);
  return res.status(200).json({ status: true, data: result.data });
};

exports.updateTaskStatus = async (req, res) => {
  const { id, status } = req.body;

  if (!id || !status) {
    await logActivity(req, PANEL, MODULE, "update-status", { message: "id & status are required" }, false);
    return res.status(400).json({ status: false, message: "id & status are required" });
  }

  try {
    const result = await ToDoService.updateTaskStatus(id, status);

    if (!result.status) {
      await logActivity(req, PANEL, MODULE, "update-status", { message: result.message }, false);
      return res.status(500).json({ status: false, message: result.message });
    }

    await logActivity(req, PANEL, MODULE, "update-status", { message: "Status updated successfully" }, true);

    const adminFullName = req.admin?.name || "Unknown Admin";
    await createNotification(
      req,
      "Task Status Updated",
      `Task status updated to "${status}" by ${adminFullName}`,
      "Support"
    );

    return res.status(200).json({ status: true, message: "Status updated successfully" });

  } catch (error) {
    console.error("❌ updateTaskStatus Controller Error:", error);
    await logActivity(req, PANEL, MODULE, "update-status", { message: error.message }, false);
    return res.status(500).json({ status: false, message: error.message });
  }
};
exports.updateSortOrder = async (req, res) => {
  const { sortOrder } = req.body;

  if (!Array.isArray(sortOrder)) {
    await logActivity(req, PANEL, MODULE, "update-sort-order", { message: "sortOrder must be an array" }, false);
    return res.status(400).json({
      status: false,
      message: "sortOrder must be an array of task IDs",
    });
  }

  try {
    const result = await ToDoService.updateSortOrder(sortOrder);

    if (!result.status) {
      await logActivity(req, PANEL, MODULE, "update-sort-order", { message: result.message }, false);
      return res.status(500).json({ status: false, message: result.message });
    }

    await logActivity(req, PANEL, MODULE, "update-sort-order", { message: "Sort order updated successfully" }, true);

    const adminFullName = req.admin?.name || "Unknown Admin";
    await createNotification(
      req,
      "Task Sort Order Updated",
      `Task order updated by ${adminFullName}`,
      "Support"
    );

    return res.status(200).json({ status: true, message: "Sort order updated successfully" });

  } catch (error) {
    console.error("❌ updateSortOrder Controller Error:", error);
    await logActivity(req, PANEL, MODULE, "update-sort-order", { message: error.message }, false);
    return res.status(500).json({ status: false, message: error.message });
  }
};
// ✅ DELETE TASK
exports.deleteTask = async (req, res) => {
  const { id } = req.params;
  const result = await ToDoService.deleteTask(id);

  if (!result.status) {
    await logActivity(req, PANEL, MODULE, "delete", { message: result.message }, false);
    return res.status(500).json({ status: false, message: result.message });
  }

  await logActivity(req, PANEL, MODULE, "delete", { message: "Deleted successfully" }, true);
  return res.status(200).json({ status: true, message: "Task deleted successfully" });
};

// ✅ Add Comment for Free Trial
// exports.addCommentForToDo = async (req, res) => {
//   const payload = req.body;

//   if (DEBUG) console.log("🎯 Add Comment Payload:", payload);

//   // ✅ Validate request body
//   const { isValid, error } = validateFormData(payload, {
//     requiredFields: ["comment"], // comment is required
//     optionalFields: ["commentType"],
//   });

//   if (!isValid) {
//     await logActivity(req, PANEL, MODULE, "create", error, false);
//     if (DEBUG) console.log("❌ Validation failed:", error);
//     return res.status(400).json({ status: false, ...error });
//   }

//   try {
//     // ✅ Use authenticated admin ID
//     const commentBy = req.admin?.id || null;

//     const result = await ToDoService.addCommentForToDo({
//       commentBy,
//       comment: payload.comment,
//       commentType: payload.commentType || "to do",
//     });

//     if (!result.status) {
//       await logActivity(req, PANEL, MODULE, "create", result, false);
//       if (DEBUG) console.log("❌ Comment creation failed:", result.message);
//       return res.status(400).json({ status: false, message: result.message });
//     }

//     // ✅ Log admin activity
//     await logActivity(
//       req,
//       PANEL,
//       MODULE,
//       "create",
//       { message: `Comment added for to do list` },
//       true
//     );
//     if (DEBUG) console.log("📝 Activity logged successfully");

//     // ✅ Notify admins
//     const createdBy = req.admin?.firstName || "An admin";
//     await createNotification(
//       req,
//       "New Comment",
//       `${createdBy} added a comment for to do list.`,
//       "Admins"
//     );
//     if (DEBUG) console.log("🔔 Notification created for admins");

//     return res.status(201).json({
//       status: true,
//       message: "✅ Comment added successfully.",
//       data: result.data,
//     });
//   } catch (error) {
//     console.error("❌ Error adding comment:", error);

//     await logActivity(
//       req,
//       PANEL,
//       MODULE,
//       "create",
//       { error: error.message },
//       false
//     );

//     return res.status(500).json({ status: false, message: "Server error." });
//   }
// };

// exports.listCommentsForToDo = async (req, res) => {
//   try {
//     const commentType = req.query.commentType || "to do";

//     const result = await ToDoService.listCommentsForToDo({
//       commentType,
//     });

//     if (!result.status) {
//       await logActivity(req, PANEL, MODULE, "list", result, false);
//       return res.status(400).json({ status: false, message: result.message });
//     }

//     await logActivity(
//       req,
//       PANEL,
//       MODULE,
//       "list",
//       { message: "Comments listed successfully" },
//       true
//     );

//     return res.status(200).json({
//       status: true,
//       message: "✅ Comments fetched successfully",
//       data: result.data,
//     });
//   } catch (error) {
//     console.error("❌ Error listing comments:", error);

//     await logActivity(
//       req,
//       PANEL,
//       MODULE,
//       "list",
//       { error: error.message },
//       false
//     );

//     return res.status(500).json({ status: false, message: "Server error." });
//   }
// };

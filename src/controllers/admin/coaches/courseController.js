const path = require("path");
const fs = require("fs");
const { validateFormData } = require("../../../utils/validateFormData");
const courseService = require("../../../services/admin/coaches/courseService.js");

const { logActivity } = require("../../../utils/admin/activityLogger");
const { createNotification } = require("../../../utils/admin/notificationHelper");
const { uploadToFTP } = require("../../../utils/uploadToFTP");
const { getMainSuperAdminOfAdmin } = require("../../../utils/auth");

// Set DEBUG flag
const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "course";

/**
 * Helper: Upload file and get FTP URL
 */
const uploadFileAndGetUrl = async (file, adminId, category, prefix) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const fileName = `${prefix}_${Date.now()}${ext}`;

  const localPath = path.join(process.cwd(), "uploads", "temp", category, `${adminId}`, fileName);
  await fs.promises.mkdir(path.dirname(localPath), { recursive: true });

  // Save temp file locally
  await fs.promises.writeFile(localPath, file.buffer);

  try {
    // Remote FTP path
    const remotePath = `/${category}/${adminId}/${fileName}`;
    const publicUrl = await uploadToFTP(localPath, remotePath);

    if (!publicUrl) throw new Error("FTP upload failed");

    return publicUrl;
  } finally {
    // Cleanup temp file
    await fs.promises.unlink(localPath).catch(() => { });
  }
};

exports.createCourse = async (req, res) => {
  const formData = req.body;
  const files = req.files;

  if (DEBUG) console.log("📥 Received formData:", formData);
  if (DEBUG) console.log("📥 Received files:", files);

  // Step 1: Validation
  const validation = validateFormData(formData, {
    requiredFields: [
      "title",
      "description",
      "modules",
      "questions",
      "duration",
      "reTakeCourse",
      "passingConditionValue",
      "isCompulsory",
      "setReminderEvery",
      "certificateTitle"
    ]
  });

  if (!validation.isValid) {
    if (DEBUG) console.log("❌ Validation failed:", validation.error);
    await logActivity(req, PANEL, MODULE, "create", validation.error, false);
    return res.status(400).json({
      status: false,
      message: validation.message,
      error: validation.error,
    });
  }

  try {
    // Step 2: Assign createdBy
    formData.createdBy = req.admin?.id;
    if (DEBUG) console.log("👤 CreatedBy:", formData.createdBy);
    const rawFiles = req.files || [];

    // Convert array → object { fieldname: [files] }
    const groupedFiles = rawFiles.reduce((acc, file) => {
      if (!acc[file.fieldname]) acc[file.fieldname] = [];
      acc[file.fieldname].push(file);
      return acc;
    }, {});
    // Step 3: Upload certificate
    if (groupedFiles.uploadCertificate?.[0]) {
      formData.uploadCertificate = await uploadFileAndGetUrl(
        groupedFiles.uploadCertificate[0],
        req.admin?.id,
        "certificates",
        "certificate"
      );
    }

    // Step 4: Upload module files (MODULE-WISE)
    if (formData.modules) {
      if (DEBUG) console.log("📂 Processing modules...");

      const modules = JSON.parse(formData.modules);

      for (let i = 0; i < modules.length; i++) {
        const moduleIndex = i + 1;
        const moduleKey = `uploadFilesModule_${moduleIndex}`;

        modules[i].uploadFiles = [];

        const moduleFiles = groupedFiles[moduleKey] || [];

        for (const file of moduleFiles) {
          const url = await uploadFileAndGetUrl(
            file,
            req.admin?.id,
            "modules",
            `module_${moduleIndex}`
          );

          modules[i].uploadFiles.push({
            originalName: file.originalname,
            mimeType: file.mimetype,
            size: file.size,
            url
          });
        }

        if (DEBUG) {
          console.log(`✅ Files for Module ${moduleIndex}:`, modules[i].uploadFiles);
        }
      }

      formData.modules = modules;
    }

    // Step 5: Save course
    if (DEBUG) console.log("💾 Saving course to DB...");
    const result = await courseService.createCourse(formData);
    if (DEBUG) console.log("✅ Course creation result:", result);

    // Step 6: Log activity
    await logActivity(req, PANEL, MODULE, "create", result, result.status);
    if (DEBUG) console.log("📝 Activity logged");

    // Step 7: Create notification
    await createNotification(req, "Course Created", `Course Created Successfully ${formData.title} by ${req?.admin?.firstName || "Admin"} ${req?.admin?.lastName || ""
      }`, "System");
    if (DEBUG) console.log("🔔 Notification sent");

    if (!result.status) {
      if (DEBUG) console.log("❌ Course creation failed:", result.message);
      return res.status(500).json({ status: false, message: result.message });
    }

    if (DEBUG) console.log("🎉 Course created successfully");
    return res.status(201).json({
      status: true,
      message: "Course created successfully.",
      data: result.data,
    });

  } catch (error) {
    console.error("❌ createCourse Error:", error);
    return res.status(500).json({
      status: false,
      message: "Server error while creating course.",
    });
  }
};

exports.getCourses = async (req, res) => {
  try {
    // Resolve super admin for access control
    const mainSuperAdminResult = await getMainSuperAdminOfAdmin(req.admin?.id);
    const superAdminId = mainSuperAdminResult?.superAdmin?.id ?? null;
    if (DEBUG) console.log(`🧩 SuperAdminId resolved as: ${superAdminId}`);

    const result = await courseService.getCourses(superAdminId, req.admin.id);

    if (!result.status) {
      return res.status(500).json({
        status: false,
        message: result.message,
      });
    }

    await logActivity(req, PANEL, MODULE, "list", "Listed all courses", true);

    return res.status(200).json(result);
  } catch (error) {
    console.error("❌ getCourses Error:", error);
    await logActivity(req, PANEL, MODULE, "list", error.message, false);

    return res.status(500).json({
      status: false,
      message: "Server error while fetching courses.",
    });
  }
};

exports.getCourseById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        status: false,
        message: "Course ID is required.",
      });
    }

    // Resolve super admin for access control
    const mainSuperAdminResult = await getMainSuperAdminOfAdmin(req.admin?.id);
    const superAdminId = mainSuperAdminResult?.superAdmin?.id ?? null;

    if (DEBUG) console.log(`🧩 SuperAdminId resolved as: ${superAdminId}`);

    // Fetch course by ID
    const result = await courseService.getCourseById(id, superAdminId, req.admin.id);

    if (!result.status) {
      return res.status(404).json({
        status: false,
        message: result.message,
      });
    }

    await logActivity(
      req,
      PANEL,
      MODULE,
      "view",
      `Viewed course with ID: ${id}`,
      true
    );

    return res.status(200).json(result);
  } catch (error) {
    console.error("❌ getCourseById Error:", error);

    await logActivity(
      req,
      PANEL,
      MODULE,
      "view",
      error.message,
      false
    );

    return res.status(500).json({
      status: false,
      message: "Server error while fetching course.",
    });
  }
};

exports.updateCourse = async (req, res) => {
  const DEBUG_MODE = DEBUG === true;

  if (DEBUG_MODE) console.log("🔄 ===== UPDATE COURSE START =====");

  const formData = req.body || {};
  const files = req.files || [];
  const { id } = req.params;

  if (DEBUG_MODE) {
    console.log("📌 Course ID:", id);
    console.log("📥 Raw Body:", req.body);
    console.log("📎 Files Count:", files.length);
  }

  // 1️⃣ Validate Course ID
  if (!id) {
    if (DEBUG_MODE) console.log("❌ Course ID missing");
    return res.status(400).json({
      status: false,
      message: "Course ID is required.",
    });
  }

  try {
    // 3️⃣ Group files by fieldname
    const groupedFiles = files.reduce((acc, file) => {
      if (!acc[file.fieldname]) acc[file.fieldname] = [];
      acc[file.fieldname].push(file);
      return acc;
    }, {});

    if (DEBUG_MODE) {
      console.log("📂 Grouped Files:", Object.keys(groupedFiles));
    }

    // 4️⃣ Upload Certificate (optional)
    if (groupedFiles.uploadCertificate?.[0]) {
      if (DEBUG_MODE) console.log("🎓 Uploading certificate...");

      formData.uploadCertificate = await uploadFileAndGetUrl(
        groupedFiles.uploadCertificate[0],
        req.admin?.id,
        "certificates",
        "certificate"
      );

      if (DEBUG_MODE)
        console.log("✅ Certificate URL:", formData.uploadCertificate);
    }

    // 5️⃣ Parse & Update Modules
    if (formData.modules) {
      if (DEBUG_MODE) console.log("📦 Processing modules...");

      const modules =
        typeof formData.modules === "string"
          ? JSON.parse(formData.modules)
          : formData.modules;

      for (let i = 0; i < modules.length; i++) {
        const moduleIndex = i + 1;
        const moduleKey = `uploadFilesModule_${moduleIndex}`;

        modules[i].uploadFiles = modules[i].uploadFiles || [];

        const moduleFiles = groupedFiles[moduleKey] || [];

        if (DEBUG_MODE)
          console.log(
            `📁 Module ${moduleIndex} Files:`,
            moduleFiles.length
          );

        for (const file of moduleFiles) {
          const url = await uploadFileAndGetUrl(
            file,
            req.admin?.id,
            "modules",
            `module_${moduleIndex}`
          );

          modules[i].uploadFiles.push({
            originalName: file.originalname,
            mimeType: file.mimetype,
            size: file.size,
            url,
          });

          if (DEBUG_MODE)
            console.log(`✅ Module ${moduleIndex} File Uploaded:`, url);
        }
      }

      formData.modules = modules;
    }

    // 6️⃣ Normalize Data Types
    if (DEBUG_MODE) console.log("🧮 Normalizing field types...");

    if (formData.duration)
      formData.duration = Number(formData.duration);

    if (formData.reTakeCourse !== undefined)
      formData.reTakeCourse = Number(formData.reTakeCourse);

    if (formData.passingConditionValue)
      formData.passingConditionValue = Number(formData.passingConditionValue);

    if (formData.setReminderEvery)
      formData.setReminderEvery = Number(formData.setReminderEvery);

    if (formData.isCompulsory !== undefined)
      formData.isCompulsory = formData.isCompulsory === "true";

    if (formData.questions && typeof formData.questions === "string") {
      formData.questions = JSON.parse(formData.questions);
    }

    if (DEBUG_MODE) console.log("🧹 Normalized Data:", formData);

    // 7️⃣ Allowed Fields Whitelist
    const allowedFields = [
      "title",
      "description",
      "duration",
      "reTakeCourse",
      "passingConditionValue",
      "isCompulsory",
      "setReminderEvery",
      "modules",
      "questions",
      "uploadCertificate",
      "certificateTitle",
    ];

    Object.keys(formData).forEach((key) => {
      if (!allowedFields.includes(key)) {
        delete formData[key];
      }
    });

    if (DEBUG_MODE)
      console.log("🛡️ Final Update Payload:", formData);

    // 8️⃣ Update Course (Service Call)
    if (DEBUG_MODE) console.log("💾 Updating course in DB...");

    const result = await courseService.updateCourse(id, formData);

    if (DEBUG_MODE) console.log("📤 Update Result:", result);

    // 9️⃣ Log Activity
    await logActivity(
      req,
      PANEL,
      MODULE,
      "update",
      result.message,
      result.status
    );

    if (!result.status) {
      if (DEBUG_MODE) console.log("❌ Update failed");
      return res.status(404).json(result);
    }

    // 🔔 Notification
    await createNotification(
      req,
      "Course Updated",
      `Course updated successfully by ${req?.admin?.firstName || "Admin"} ${req?.admin?.lastName || ""
      }`,
      "System"
    );

    if (DEBUG_MODE) console.log("🎉 Course updated successfully");
    if (DEBUG_MODE) console.log("🔄 ===== UPDATE COURSE END =====");

    return res.status(200).json(result);
  } catch (error) {
    console.error("❌ updateCourse Error:", error);

    return res.status(500).json({
      status: false,
      message: "Server error while updating course.",
    });
  }
};

exports.deleteCourse = async (req, res) => {
  const { id } = req.params;
  const deletedBy = req.admin?.id;

  if (!id) {
    return res.status(400).json({
      status: false,
      message: "Course ID is required.",
    });
  }

  try {
    if (DEBUG) console.log("🗑️ Deleting Course ID:", id);

    const result = await courseService.deleteCourse(id, deletedBy);

    await logActivity(
      req,
      PANEL,
      MODULE,
      "delete",
      result.message,
      result.status
    );

    if (!result.status) {
      return res.status(404).json(result);
    }

    await createNotification(
      req,
      "Course Deleted",
      `Course deleted successfully by ${req?.admin?.firstName || "Admin"} ${req?.admin?.lastName || ""
      }`,
      "System"
    );

    return res.status(200).json(result);
  } catch (error) {
    console.error("❌ deleteCourse Error:", error);

    return res.status(500).json({
      status: false,
      message: "Server error while deleting course.",
    });
  }
};

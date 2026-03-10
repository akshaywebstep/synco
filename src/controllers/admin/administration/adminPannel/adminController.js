const bcrypt = require("bcrypt");
const path = require("path");
const fs = require("fs");

const { createToken } = require("../../../../utils/jwt");
const { uploadToFTP } = require("../../../../utils/uploadToFTP");
const { generatePasswordHint, getMainSuperAdminOfAdmin } = require("../../../../utils/auth");
const sendEmail = require("../../../../utils/email/sendEmail");

const adminModel = require("../../../../services/admin/administration/adminPannel/admin");
const { getAdminRoleById } = require("../../../../services/admin/adminRole");
const emailModel = require("../../../../services/email");
const countryModel = require("../../../../services/location/country");
const { validateFormData } = require("../../../../utils/validateFormData");
const { saveFile, deleteFile } = require("../../../../utils/fileHandler");

const { logActivity } = require("../../../../utils/admin/activityLogger");
const { createNotification } = require("../../../../utils/admin/notificationHelper");

// Set DEBUG flag
const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "admin";

const allowedExtensions = [
  "jpg",
  "jpeg",
  "png",
  "webp",
  "gif",
  "bmp",
  "tiff",
  "heic",
  "svg",
  "jfif",
];

const uploadFileAndGetUrl = async (
  file,
  adminId,
  category, // "profile" | "qualifications"
  prefix
) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const fileName = `${prefix}_${Date.now()}${ext}`;

  // TEMP LOCAL PATH
  const localPath = path.join(
    process.cwd(),
    "uploads",
    "temp",
    category,
    `${adminId}`,
    fileName
  );

  await fs.promises.mkdir(path.dirname(localPath), { recursive: true });
  await saveFile(file, localPath);

  try {
    // FTP REMOTE PATH (IMPORTANT)
    const remotePath = `/${category}/${adminId}/${fileName}`;

    const publicUrl = await uploadToFTP(localPath, remotePath);

    if (!publicUrl) {
      throw new Error("FTP upload failed");
    }

    return publicUrl;
  } finally {
    // CLEAN TEMP FILE
    await fs.promises.unlink(localPath).catch(() => { });
  }
};

const ADMIN_RESET_URL =
  process.env.ADMIN_RESET_URL ||
  "https://synco-admin-portal.netlify.app/reset-password";

/* =======================
   CREATE ADMIN
======================= */
exports.createAdmin = async (req, res) => {
  try {
    const formData = req.body;
    const files = req.files || {};
    const mainSuperAdminResult = await getMainSuperAdminOfAdmin(req.admin.id);
    const superAdminId = mainSuperAdminResult?.superAdmin.id ?? null;

    const {
      email,
      firstName,
      lastName = "",
      position,
      phoneNumber,
      role: roleId,
      password,
      postalCode,
      gcFranchiseToken,
    } = formData;

    /* =======================
       ROLE CHECK
    ======================= */
    const roleResult = await getAdminRoleById(roleId);
    const isCoach =
      roleResult?.status &&
      roleResult.data?.role?.toLowerCase() === "coach";
    const isFranchisee =
      roleResult?.status &&
      roleResult.data?.role?.toLowerCase() === "franchisee";
    if (isFranchisee && !gcFranchiseToken?.trim()) {
      return res.status(400).json({
        status: false,
        message: "GC_FRANCHISE_TOKEN is required for franchisee",
      });
    }

    /* =======================
       EMAIL EXISTS CHECK
    ======================= */
    const { status: exists } =
      await adminModel.findAdminByEmail(email);

    if (exists) {
      return res.status(409).json({
        status: false,
        message: "Email already exists",
      });
    }

    /* =======================
       PASSWORD HANDLING
    ======================= */
    let hashedPassword = null;
    let passwordHint = null;

    if (password) {
      hashedPassword = await bcrypt.hash(password, 10);
      passwordHint = generatePasswordHint(password);
    }

    /* =======================
       RESET OTP
    ======================= */
    const resetOtp = Math.random().toString(36).substring(2, 12);
    const resetOtpExpiry = new Date(Date.now() + 86400000); // 24 hrs

    /* =======================
       CREATE ADMIN
    ======================= */
    const createResult = await adminModel.createAdmin({
      firstName,
      lastName,
      email,
      password: hashedPassword,
      passwordHint,
      position,
      phoneNumber,
      roleId,
      postalCode,
      resetOtp,
      resetOtpExpiry,
      status: true,
      qualifications: null,
      // 👇 DB field same capital me
      GC_FRANCHISE_TOKEN: isFranchisee
        ? gcFranchiseToken.trim()
        : null,
      createdByAdmin: req.admin?.id ?? null,
      superAdminId,
    });

    if (!createResult.status) {
      return res.status(500).json({
        status: false,
        message: "Failed to create admin",
      });
    }

    const admin = createResult.data;

    /* =======================
       PROFILE UPLOAD
    ======================= */
    if (files.profile?.[0]) {
      const profileUrl = await uploadFileAndGetUrl(
        files.profile[0],
        admin.id,
        "profile",
        "profile"
      );
      await adminModel.updateAdmin(admin.id, {
        profile: profileUrl,
      });
    }

    /* =======================
       QUALIFICATIONS (COACH)
    ======================= */
    if (isCoach) {
      const qualifications = {
        fa_level_1: files.fa_level_1?.[0]
          ? await uploadFileAndGetUrl(
            files.fa_level_1[0],
            admin.id,
            "qualifications",
            "fa_level_1"
          )
          : null,

        futsal_level_1_qualification:
          files.futsal_level_1_qualification?.[0]
            ? await uploadFileAndGetUrl(
              files.futsal_level_1_qualification[0],
              admin.id,
              "qualifications",
              "futsal_level_1_qualification"
            )
            : null,

        first_aid: files.first_aid?.[0]
          ? await uploadFileAndGetUrl(
            files.first_aid[0],
            admin.id,
            "qualifications",
            "first_aid"
          )
          : null,

        futsal_level_1: files.futsal_level_1?.[0]
          ? await uploadFileAndGetUrl(
            files.futsal_level_1[0],
            admin.id,
            "qualifications",
            "futsal_level_1"
          )
          : null,
      };

      await adminModel.updateAdmin(admin.id, { qualifications });
    }

    /* =======================
       EMAIL: RESET LINK
    ======================= */
    let emailSentFlag = 0;

    const emailConfigResult = await emailModel.getEmailConfig(
      "admin",
      "create admin"
    );

    const { emailConfig, htmlTemplate, subject } =
      emailConfigResult || {};

    if (!emailConfigResult?.status || !emailConfig) {
      console.warn("⚠️ No email config found for create admin");
    } else {
      const resetLink = `${ADMIN_RESET_URL}?email=${encodeURIComponent(
        email
      )}&token=${resetOtp}`;

      const replacements = {
        "{{firstName}}": firstName || "",
        "{{lastName}}": lastName || "",
        "{{email}}": email,
        "{{resetLink}}": resetLink,
        "{{year}}": new Date().getFullYear().toString(),
        "{{appName}}": "Synco",
        "{{logoUrl}}":
          "https://webstepdev.com/demo/syncoUploads/syncoLogo.png",
      };

      const replacePlaceholders = (text) =>
        typeof text === "string"
          ? Object.entries(replacements).reduce(
            (result, [key, val]) =>
              result.replace(new RegExp(key, "g"), val),
            text
          )
          : text;

      const emailSubject = replacePlaceholders(
        subject || "Set your Admin Panel password"
      );

      const htmlBody = replacePlaceholders(
        htmlTemplate?.trim() ||
        `<p>Hello {{firstName}},</p>
           <p>Your admin account for <strong>{{appName}}</strong> has been created.</p>
           <p>Set your password using the link below:</p>
           <p><a href="{{resetLink}}" target="_blank">{{resetLink}}</a></p>
           <p>This link will expire in <strong>24 hours</strong>.</p>
           <p>Regards,<br>{{appName}} Team<br>&copy; {{year}}</p>`
      );

      const mapRecipients = (list) =>
        Array.isArray(list)
          ? list.map(({ name, email }) => ({
            name: replacePlaceholders(name),
            email: replacePlaceholders(email),
          }))
          : [];

      const mailData = {
        recipient: [
          {
            name: `${firstName} ${lastName}`.trim(),
            email,
          },
        ],
        cc: mapRecipients(emailConfig.cc),
        bcc: mapRecipients(emailConfig.bcc),
        subject: emailSubject,
        htmlBody,
        attachments: [],
      };

      const emailResult = await sendEmail(
        emailConfig,
        mailData
      );

      if (emailResult?.status) {
        emailSentFlag = 1;
        if (DEBUG)
          console.log(
            "✅ Create admin email sent:",
            emailResult.messageId
          );
      } else {
        console.error(
          "❌ Failed to send create admin email:",
          emailResult?.error
        );
      }
    }

    /* =======================
       RESPONSE
    ======================= */
    return res.status(201).json({
      status: true,
      message: "Admin created successfully",
      data: {
        id: admin.id,
        email: admin.email,
        emailSent: emailSentFlag,
      },
    });
  } catch (error) {
    console.error("❌ Create Admin Error:", error);
    return res.status(500).json({
      status: false,
      message: "Server error occurred",
    });
  }
};


// ✅ Get all admins

exports.getAllAdmins = async (req, res) => {
  if (DEBUG) console.log("📋 Request received to list all admins");
  const mainSuperAdminResult = await getMainSuperAdminOfAdmin(req.admin?.id);
  const superAdminId = mainSuperAdminResult?.superAdmin.id ?? null;
  try {
    const loggedInAdminId = req.admin?.id; // Get the current admin's ID

    const result = await adminModel.getAllAdmins(superAdminId, loggedInAdminId); // Pass it to the service

    if (!result.status) {
      if (DEBUG) console.log("❌ Failed to retrieve admins:", result.message);

      await logActivity(req, PANEL, MODULE, "list", result, false);
      return res.status(500).json({
        status: false,
        message: result.message || "Failed to fetch admins.",
      });
    }

    if (DEBUG) {
      console.log(`✅ Retrieved ${result.data.length} admin(s)`);
      console.table(
        result.data.map((m) => ({
          ID: m.id,
          Name: m.name,
          Email: m.email,
          Created: m.createdAt,
        }))
      );
    }

    await logActivity(
      req,
      PANEL,
      MODULE,
      "list",
      {
        oneLineMessage: `Fetched ${result.data.length} admin(s) successfully.`,
      },
      true
    );

    return res.status(200).json({
      status: true,
      message: `Fetched ${result.data.length} admin(s) successfully.`,
      data: result.data,
    });
  } catch (error) {
    console.error("❌ List Admins Error:", error);
    return res.status(500).json({
      status: false,
      message: "Failed to fetch admins. Please try again later.",
    });
  }
};

// ✅ Get a specific admin / coach / super admin profile
exports.getAdminProfile = async (req, res) => {
  const { id } = req.params;

  if (DEBUG) console.log("👤 Fetching profile for ID:", id);

  try {
    const result = await adminModel.getAdminById(id);

    if (!result.status || !result.data) {
      if (DEBUG) console.log("❌ User not found with ID:", id);
      return res.status(404).json({
        status: false,
        message: "User not found.",
      });
    }

    const { data: admin } = result;

    if (DEBUG) console.log("✅ User found:", admin);

    // ✅ Extract role safely
    const roleName = admin?.role?.role || "";

    // 🔥 Role-based success message
    let successMessage;

    switch (roleName.toLowerCase()) {
      case "coach":
        successMessage = "Coach data fetched successfully.";
        break;

      case "super admin":
        successMessage = "Super admin data fetched successfully.";
        break;

      case "admin":
        successMessage = "Admin data fetched successfully.";
        break;

      default:
        successMessage = "User profile fetched successfully.";
    }

    return res.status(200).json({
      status: true,
      message: successMessage,
      data: admin,
    });
  } catch (error) {
    console.error("❌ Get Profile Error:", error);
    return res.status(500).json({
      status: false,
      message: "Failed to fetch profile.",
    });
  }
};

// ✅ Update admin details
exports.updateAdmin = async (req, res) => {
  const { id } = req.params;
  const formData = req.body;
  const file = req.file;

  if (DEBUG) console.log("🛠️ Updating admin ID:", id);
  if (DEBUG) console.log("📥 Received Update FormData:", formData);
  if (DEBUG && file) console.log("📎 Received File:", file.originalname);

  try {
    // 🔎 Check if admin exists
    const existing = await adminModel.getAdminById(id);
    if (!existing.status || !existing.data) {
      return res
        .status(404)
        .json({ status: false, message: "Admin not found." });
    }
    const existingAdmin = existing.data;

    // 🔎 Check for duplicate email
    const { status: exists, data: foundAdmin } =
      await adminModel.findAdminByEmail(formData.email);
    if (exists && foundAdmin && foundAdmin.id.toString() !== id.toString()) {
      return res.status(409).json({
        status: false,
        message: "This email is already registered. Please use another email.",
      });
    }

    // ✅ Validate input
    const validation = validateFormData(formData, {
      requiredFields: [
        // "firstName",
        // "email",
        // "phoneNumber",
        // "country",
        // "city",
        // "postalCode",
      ],
      patternValidations: {
        email: "email",
        status: "boolean",
        country: "number",
      },
      fileExtensionValidations: { profile: allowedExtensions },
    });
    if (!validation.isValid) {
      const firstField = Object.keys(validation.error)[0];
      return res.status(400).json({
        status: false,
        field: firstField,
        message: validation.error[firstField],
      });
    }

    // ✅ Prepare update data
    const updateData = {};

    // Basic fields
    if (formData.firstName !== undefined)
      updateData.firstName = formData.firstName?.trim();

    if (formData.lastName !== undefined)
      updateData.lastName = formData.lastName?.trim();

    if (formData.email !== undefined)
      updateData.email = formData.email?.trim();

    if (formData.position !== undefined)
      updateData.position = formData.position?.trim();

    if (formData.phoneNumber !== undefined)
      updateData.phoneNumber = formData.phoneNumber?.trim();

    // Role (only if provided)
    if (formData.role !== undefined) {
      updateData.roleId = formData.role;
    }

    // Location fields
    if (formData.country !== undefined) {
      updateData.countryId = formData.country || null;
    }

    if (formData.state !== undefined) {
      updateData.stateId = formData.state || null;
    }

    if (formData.city !== undefined) {
      updateData.city = formData.city || null;
    }

    if (formData.postalCode !== undefined) {
      updateData.postalCode = formData.postalCode || null;
    }

    // GC Franchise Token
    if (formData.gcFranchiseToken !== undefined) {
      updateData.GC_FRANCHISE_TOKEN =
        formData.gcFranchiseToken?.trim() || null;
    }

    // Status
    if (formData.status !== undefined) {
      const statusRaw = formData.status.toString().toLowerCase();
      updateData.status = ["true", "1", "yes", "active"].includes(statusRaw);
    }
    // =======================
    // GC_FRANCHISE_TOKEN (Optional Update)
    // =======================
    if (formData.gcFranchiseToken !== undefined) {
      updateData.GC_FRANCHISE_TOKEN =
        formData.gcFranchiseToken?.trim() || null;
    }

    if (formData.status) {
      const statusRaw = formData.status.toString().toLowerCase();
      updateData.status = ["true", "1", "yes", "active"].includes(statusRaw);
    }

    // ✅ Handle profile image upload via new FTP function
    if (file) {
      const ext = path
        .extname(file.originalname)
        .toLowerCase()
        .replace(".", "");
      if (!allowedExtensions.includes(ext)) {
        return res.status(400).json({
          status: false,
          field: "profile",
          message: `Invalid file type. Allowed: ${allowedExtensions.join(
            ", "
          )}`,
        });
      }

      const uniqueId = Math.floor(Math.random() * 1e9);
      const fileName = `${Date.now()}_${uniqueId}.${ext}`;
      const localPath = path.join(
        process.cwd(),
        "uploads",
        "temp",
        "admin",
        `${id}`,
        "profile",
        fileName
      );

      await fs.promises.mkdir(path.dirname(localPath), { recursive: true });
      await saveFile(file, localPath);

      try {
        const savedProfilePath = await uploadToFTP(localPath, fileName);
        if (!savedProfilePath) {
          throw new Error("FTP upload failed");
        }

        updateData.profile = savedProfilePath;

        // Delete old profile if exists
        if (existingAdmin.profile) {
          await deleteFile(existingAdmin.profile);
        }

        if (DEBUG) console.log("✅ Profile updated at:", savedProfilePath);
      } catch (err) {
        console.error("❌ Error uploading profile image:", err.message);
        return res.status(500).json({
          status: false,
          message: "Failed to upload profile image. Please try again.",
        });
      } finally {
        await fs.promises.unlink(localPath).catch(() => { });
      }
    }

    /* =======================
    QUALIFICATIONS UPDATE (COACH)
    ======================= */

    if (req.files) {

      const roleResult = await getAdminRoleById(existingAdmin.roleId);
      const isCoach =
        roleResult?.status &&
        roleResult.data?.role?.toLowerCase() === "coach";

      if (isCoach) {

        let existingQualifications =
          typeof existingAdmin.qualifications === "string"
            ? JSON.parse(existingAdmin.qualifications)
            : existingAdmin.qualifications || {};

        const updatedQualifications = { ...existingQualifications };

        if (req.files.fa_level_1?.[0]) {
          updatedQualifications.fa_level_1 = await uploadFileAndGetUrl(
            req.files.fa_level_1[0],
            id,
            "qualifications",
            "fa_level_1"
          );
        }

        if (req.files.futsal_level_1_qualification?.[0]) {
          updatedQualifications.futsal_level_1_qualification =
            await uploadFileAndGetUrl(
              req.files.futsal_level_1_qualification[0],
              id,
              "qualifications",
              "futsal_level_1_qualification"
            );
        }

        if (req.files.first_aid?.[0]) {
          updatedQualifications.first_aid = await uploadFileAndGetUrl(
            req.files.first_aid[0],
            id,
            "qualifications",
            "first_aid"   
          );
        }

        if (req.files.futsal_level_1?.[0]) {
          updatedQualifications.futsal_level_1 = await uploadFileAndGetUrl(
            req.files.futsal_level_1[0],
            id,
            "qualifications",
            "futsal_level_1"
          );
        }

        updateData.qualifications = updatedQualifications;

        if (DEBUG)
          console.log("🎓 Qualifications updated:", updatedQualifications);
      }
    }


    // ✅ Handle removedImage flag
    if (formData.removedImage === "true" || formData.removedImage === true) {
      if (existingAdmin.profile) {
        try {
          await deleteFile(existingAdmin.profile);
          updateData.profile = null;
          if (DEBUG) console.log("🗑️ Old profile image removed.");
        } catch (err) {
          console.error("❌ Error removing old profile image:", err);
        }
      }
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        status: false,
        message: "No valid fields provided to update.",
      });
    }

    // ✅ Update DB
    const updateResult = await adminModel.updateAdmin(id, updateData);
    if (!updateResult.status) {
      return res.status(500).json({
        status: false,
        message: updateResult.message || "Failed to update admin.",
      });
    }

    // ✅ Log activity + notification
    await logActivity(
      req,
      PANEL,
      MODULE,
      "update",
      { oneLineMessage: `Admin '${formData.firstName}' updated successfully.` },
      true
    );
    await createNotification(
      req,
      "Admin Updated",
      `Admin '${formData.firstName}' was updated by ${req?.admin?.firstName || "System"
      }.`,
      "System"
    );

    return res
      .status(200)
      .json({ status: true, message: "Admin updated successfully." });
  } catch (error) {
    console.error("❌ Update Admin Error:", error);
    return res.status(500).json({
      status: false,
      message: "Failed to update admin. Please try again later.",
    });
  }
};

// exports.updateAdmin = async (req, res) => {
//   const { id } = req.params;
//   const formData = req.body;
//   const file = req.file;
//   const createdByRole = req.admin?.role || "Admin";

//   if (DEBUG) console.log("🛠️ Updating admin ID:", id);
//   if (DEBUG) console.log("📥 Received Update FormData:", formData);
//   if (DEBUG && file) console.log("📎 Received File:", file.originalname);

//   try {
//     // Check if admin exists
//     const existing = await adminModel.getAdminById(id);
//     if (!existing.status || !existing.data) {
//       if (DEBUG) console.log("❌ Admin not found:", id);
//       return res
//         .status(404)
//         .json({ status: false, message: "Admin not found." });
//     }

//     if (DEBUG)
//       console.log("🔍 Checking if email already exists:", formData.email);

//     const { status: exists, data: existingAdmin } =
//       await adminModel.findAdminByEmail(formData.email);
//     if (DEBUG)
//       console.log("{ status: exists, data: existingAdmin }:", {
//         status: exists,
//         data: existingAdmin,
//       });

//     if (
//       exists &&
//       existingAdmin &&
//       existingAdmin.id.toString() !== id.toString()
//     ) {
//       if (DEBUG) console.log("❌ Email already registered:", formData.email);
//       return res.status(409).json({
//         status: false,
//         message: "This email is already registered. Please use another email.",
//       });
//     }

//     // Validate input (if any fields sent)
//     const validation = validateFormData(formData, {
//       requiredFields: [
//         "firstName",
//         "email",
//         "position",
//         "phoneNumber",
//         "country",
//         "city",
//         "postalCode",
//       ],
//       patternValidations: {
//         email: "email",
//         status: "boolean",
//         country: "number",
//       },
//       fileExtensionValidations: {
//         profile: [
//           "jpg",
//           "jpeg",
//           "png",
//           "webp",
//           "gif",
//           "bmp",
//           "tiff",
//           "heic",
//           "svg",
//         ],
//       },
//     });

//     if (!validation.isValid) {
//       if (DEBUG) console.log("❌ Validation failed:", validation.error);
//       return res.status(400).json({
//         status: false,
//         error: validation.error,
//         message: validation.message,
//       });
//     }

//     // Prepare update data
//     const updateData = {};
//     if (formData.firstName)
//       updateData.firstName = String(formData.firstName).trim();
//     if (formData.lastName)
//       updateData.lastName = String(formData.lastName).trim();
//     if (formData.email) updateData.email = String(formData.email).trim();
//     if (formData.position)
//       updateData.position = String(formData.position).trim();
//     if (formData.phoneNumber)
//       updateData.phoneNumber = String(formData.phoneNumber).trim();
//     if (formData.role) updateData.roleId = formData.role;
//     if (formData.country) updateData.countryId = formData.country;
//     if (formData.state) updateData.stateId = formData.state;
//     if (formData.city) updateData.city = formData.city;
//     if (formData.postalCode) updateData.postalCode = formData.postalCode;
//     if (formData.status) {
//       const statusRaw = formData.status.toString().toLowerCase();
//       updateData.status = ["true", "1", "yes", "active"].includes(statusRaw);
//     }

//     const countryCheck = await countryModel.getCountryById(
//       updateData.countryId
//     );
//     if (!countryCheck.status) {
//       return res.status(400).json({
//         status: false,
//         message: `${countryCheck.message}`,
//       });
//     }

//     // Handle new profile image (if any)
//     if (file) {
//       const uniqueId = Math.floor(Math.random() * 1e9);
//       const ext = path.extname(file.originalname).toLowerCase();
//       const fileName = `${Date.now()}_${uniqueId}${ext}`;

//       const fullPath = path.join(
//         process.cwd(),
//         "uploads",
//         "admin",
//         `${id}`,
//         "profile",
//         fileName
//       );
//       const relativePath = `uploads/admin/${id}/profile/${fileName}`;

//       if (DEBUG) console.log("📁 Saving profile to:", fullPath);

//       try {
//         await saveFile(file, fullPath);
//         updateData.profile = relativePath;

//         await deleteFile(existingAdmin.profile);
//         if (DEBUG) console.log("✅ Profile image saved and path set.");
//       } catch (fileErr) {
//         console.error("❌ Error saving profile image:", fileErr);
//       }
//     }

//     // No update fields?
//     if (Object.keys(updateData).length === 0) {
//       return res.status(400).json({
//         status: false,
//         message: "No valid fields provided to update.",
//       });
//     }

//     // Update DB
//     const updateResult = await adminModel.updateAdmin(id, updateData);

//     if (!updateResult.status) {
//       if (DEBUG)
//         console.log("❌ Failed to update admin:", updateResult.message);
//       return res.status(500).json({
//         status: false,
//         message: updateResult.message || "Failed to update admin.",
//       });
//     }

//     if (DEBUG) console.log("✅ Admin updated successfully.");
//     let roleName = "User";
//     if (formData.role) {
//       const roleResult = await getAdminRoleById(formData.role);
//       if (roleResult?.status && roleResult.data?.role) {
//         roleName = roleResult.data.role;
//       }
//     }
//     await logActivity(
//       req,
//       "Admin Panel",
//       "Admins",
//       "update",
//       {
//         oneLineMessage: `Admin '${formData.firstName}' updated successfully.`,
//         adminId: id,
//       },
//       true
//     );

//     await createNotification(
//       req,
//       "Admin Updated",
//       `Admin '${formData.firstName}' was updated by ${
//         req?.admin?.firstName || "System"
//       }.`,
//       "System"
//     );
//     return res.status(200).json({
//       status: true,
//       message: "Admin updated successfully.",
//     });
//   } catch (error) {
//     console.error("❌ Update Admin Error:", error);
//     return res.status(500).json({
//       status: false,
//       message: "Failed to update admin. Please try again later.",
//     });
//   }
// };

// ✅ Update admin status
exports.changeAdminStatus = async (req, res) => {
  const { id } = req.params;
  const { status } = req.query;

  if (DEBUG)
    console.log(`🔄 Request to change admin ID ${id} status to: ${status}`);

  const allowedStatuses = ["active", "inactive", "suspend"];
  const normalizedStatus = status?.toString().toLowerCase();

  if (!allowedStatuses.includes(normalizedStatus)) {
    return res.status(400).json({
      status: false,
      message: `Invalid status. Allowed values: ${allowedStatuses.join(", ")}`,
    });
  }

  try {
    const result = await adminModel.getAdminById(id);
    if (!result.status || !result.data) {
      if (DEBUG) console.log("❌ Admin not found:", id);
      return res
        .status(404)
        .json({ status: false, message: "Admin not found." });
    }

    const updateResult = await adminModel.updateAdmin(id, {
      status: normalizedStatus,
    });

    if (!updateResult.status) {
      return res.status(500).json({
        status: false,
        message: updateResult.message || "Failed to update status.",
      });
    }

    if (DEBUG)
      console.log(
        `✅ Status of admin ID ${id} changed to: ${normalizedStatus}`
      );

    return res.status(200).json({
      status: true,
      message: `Admin status updated to '${normalizedStatus}' successfully.`,
    });
  } catch (error) {
    if (DEBUG) error("❌ Change Admin Status Error:", error);
    return res.status(500).json({
      status: false,
      message: "Failed to update admin status. Please try again later.",
    });
  }
};

// ✅ Delete an admin (soft delete)
// exports.deleteAdmin = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const currentAdminId = req.admin.id; 

//     // 🔍 Check if admin exists (including soft-deleted check)
//     const { status, data } = await adminModel.getAdminById(id);
//     if (!status || !data) {
//       return res.status(404).json({
//         status: false,
//         message: "Admin not found",
//       });
//     }

//     // 🚮 Soft delete admin
//     const result = await adminModel.deleteAdmin(id, currentAdminId);

//     if (!result.status) {
//       return res.status(400).json(result);
//     }

//     return res.status(200).json({
//       status: true,
//       message: "Admin deleted successfully",
//     });
//   } catch (error) {
//     console.error("❌ deleteAdmin Error:", error);
//     return res.status(500).json({
//       status: false,
//       message:
//         error?.parent?.sqlMessage || "Server error while deleting admin.",
//     });
//   }
// };

exports.deleteAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    // const { transferToAdminId } = req.body;
    const { transferToAdminId } = req.body || {};

    if (DEBUG) console.log("🔍 deleteAdmin request:", { id, transferToAdminId });

    // Check admin exists
    const { status, data } = await adminModel.getAdminById(id);
    if (!status || !data) {
      return res.status(404).json({ status: false, message: "Admin not found" });
    }

    const result = await adminModel.deleteAdmin(id, transferToAdminId);

    if (!result.status) return res.status(400).json(result);

    return res.status(200).json({
      status: true,
      message: result.message,
    });
  } catch (error) {
    console.error("❌ deleteAdmin Controller Error:", error);
    return res.status(500).json({
      status: false,
      message: error?.parent?.sqlMessage || "Server error while deleting admin",
    });
  }
};

// ✅ Get all admins
exports.getAllAdminsForReassign = async (req, res) => {
  if (DEBUG) console.log("📋 Request received to list all admins");

  try {
    // ✅ No need to pass loggedInAdminId to the service
    const result = await adminModel.getAllAdminsForReassignData();

    if (!result.status) {
      if (DEBUG) console.log("❌ Failed to retrieve admins:", result.message);

      await logActivity(req, PANEL, MODULE, "list", result, false);
      return res.status(500).json({
        status: false,
        message: result.message || "Failed to fetch admins.",
      });
    }

    if (DEBUG) {
      console.log(`✅ Retrieved ${result.data.length} admin(s)`);
      console.table(
        result.data.map((m) => ({
          ID: m.id,
          Name: `${m.firstName} ${m.lastName}`,
          Email: m.email,
          Created: m.createdAt,
        }))
      );
    }

    await logActivity(
      req,
      PANEL,
      MODULE,
      "list",
      {
        oneLineMessage: `Fetched ${result.data.length} admin(s) successfully.`,
      },
      true
    );

    return res.status(200).json({
      status: true,
      message: `Fetched ${result.data.length} admin(s) successfully.`,
      data: result.data,
    });
  } catch (error) {
    console.error("❌ List Admins Error:", error);
    return res.status(500).json({
      status: false,
      message: "Failed to fetch admins. Please try again later.",
    });
  }
};

exports.resetPassword = async (req, res) => {
  try {
    const { newPassword, confirmPassword } = req.body;
    const { email, token } = req.query;

    // 🧪 Validate query parameters
    if (!email || !token) {
      return res.status(400).json({
        status: false,
        message: "Reset link is invalid or missing required parameters.",
      });
    }

    // 🧪 Validate password fields
    if (!newPassword || !confirmPassword) {
      return res.status(400).json({
        status: false,
        message: "New password and confirm password are required.",
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        status: false,
        message: "New password and confirm password do not match.",
      });
    }

    // 🔍 Find admin
    const { status, data: admin } = await adminModel.findAdminByEmail(email);

    if (!status || !admin) {
      return res.status(404).json({
        status: false,
        message: "Admin account not found.",
      });
    }

    // 🧾 Debug: Log everything
    console.log("🔍 Incoming email:", email);
    console.log("🔍 Incoming token:", `"${token}"`);
    console.log("🔍 DB resetOtp:", `"${admin.resetOtp}"`);
    console.log("🔍 DB resetOtpExpiry:", admin.resetOtpExpiry);
    console.log("🕒 Current time:", new Date().toISOString());

    // ✅ Clean token before comparing (prevent hidden spaces)
    const incomingToken = token.trim();
    const storedToken = admin.resetOtp?.trim();

    // 🚫 Token mismatch
    if (!storedToken || storedToken !== incomingToken) {
      return res.status(401).json({
        status: false,
        message: "Invalid reset token.",
      });
    }

    // 🚫 Token expired
    const isExpired = new Date(admin.resetOtpExpiry) < new Date();
    if (isExpired) {
      return res.status(401).json({
        status: false,
        message: "Reset token has expired. Please request a new reset link.",
      });
    }

    // 🔒 Hash the new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    const passwordHint = generatePasswordHint(newPassword);

    // 📦 Update admin
    const updateResult = await adminModel.updateAdmin(admin.id, {
      password: hashedPassword,
      passwordHint,
      resetOtp: null,
      resetOtpExpiry: null,
    });

    if (!updateResult.status) {
      return res.status(500).json({
        status: false,
        message: updateResult.message || "Failed to reset password.",
      });
    }

    return res.status(200).json({
      status: true,
      message: "Password reset successfully. You can now log in.",
    });
  } catch (error) {
    console.error("❌ Reset Password Error:", error);
    return res.status(500).json({
      status: false,
      message: "Server error while resetting password. Try again later.",
    });
  }
};

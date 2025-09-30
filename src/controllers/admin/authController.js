const bcrypt = require("bcrypt");
const crypto = require("crypto");
const { createToken } = require("../../utils/jwt");
const sendEmail = require("../../utils/email/sendEmail");

const adminModel = require("../../services/admin/admin");
const emailModel = require("../../services/email");

const DEBUG = process.env.DEBUG === "true";

// ✅ Register a new admin
exports.register = async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res
      .status(400)
      .json({ message: "All fields are required: name, email, and password." });
  }

  try {
    const { status: exists, data: existingAdmin } =
      await adminModel.findAdminByEmail(email);

    if (exists && existingAdmin) {
      return res.status(409).json({
        message:
          "This email is already registered. Please login or use another email.",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const { status, data, message } = await adminModel.createAdmin({
      firstName: name,
      email,
      password: hashedPassword,
    });

    if (!status) {
      return res.status(500).json({
        message: message || "Failed to register admin. Please try again.",
      });
    }

    return res.status(201).json({
      message: "Registration successful. You can now log in.",
      data: { adminId: data.id },
    });
  } catch (error) {
    console.error("❌ Registration Error:", error);
    return res.status(500).json({
      message:
        "Internal server error during registration. Please try again later.",
    });
  }
};

// // ✅ Login admin
// exports.login = async (req, res) => {
//   const { email, password } = req.body;

//   if (!email || !password) {
//     return res
//       .status(400)
//       .json({ message: "Both email and password are required." });
//   }

//   try {
//     const { status, data: admin } = await adminModel.findAdminByEmail(email);

//     if (
//       !status ||
//       !admin ||
//       !(await bcrypt.compare(password, admin.password))
//     ) {
//       return res
//         .status(401)
//         .json({ message: "Invalid email or password. Please try again." });
//     }

//     if (DEBUG) console.log(`admin - `, admin);
//     const token = createToken({
//       id: admin.id,
//       name: admin.name,
//       email: admin.email,
//       role: admin.role.role,
//     });

//     return res.status(200).json({
//       message: "Login successful.",
//       data: {
//         admin: {
//           id: admin.id,
//           name: admin.name,
//           email: admin.email,
//           role: admin.role.role,
//         },
//         token,
//       },
//     });
//   } catch (error) {
//     console.error("❌ Login Error:", error);
//     return res.status(500).json({
//       message: "Internal server error during login. Please try again later.",
//     });
//   }
// };

// exports.login = async (req, res) => {
//   const { email, password } = req.body;

//   if (!email || !password) {
//     return res
//       .status(400)
//       .json({ message: "Both email and password are required." });
//   }

//   try {
//     // 1. Find admin by email
//     const { status, data: admin } = await adminModel.findAdminByEmail(email);

//     // ✅ Log what was returned for debugging
//     if (DEBUG) console.log("📥 Admin lookup result:", { status, admin });

//     // ✅ Filter active permissions and extract module & action
//     const activePermissions = (admin.role?.permissions || [])
//       .filter((p) => p.status === true) // only status: true
//       .map((p) => ({ module: p.module, action: p.action })); // keep only module & action

//     // ✅ Debug
//     if (DEBUG) console.log("🔑 Active permissions:", activePermissions);

//     // 2. Check if admin exists
//     if (!admin) {
//       return res.status(401).json({
//         message: "Invalid email address. Please try again.",
//       });
//     }

//     // 3. Check if account is suspended
//     if (admin.status && admin.status.toLowerCase() === "suspend") {
//       return res.status(403).json({
//         message:
//           "Your account is suspended and cannot be accessed. Please contact support.",
//       });
//     }

//     // 4. Check password
//     const isMatch = await bcrypt.compare(password, admin.password);
//     if (!isMatch) {
//       return res.status(401).json({
//         message: "Incorrect password. Please try again.",
//       });
//     }

//     // 5. Create token
//     const token = createToken({
//       id: admin.id,
//       name: admin.name,
//       email: admin.email,
//       role: admin.role.role,
//     });

//     return res.status(200).json({
//       message: "Login successful.",
//       data: {
//         admin: {
//           id: admin.id,
//           name: admin.name,
//           email: admin.email,
//           role: admin.role.role,
//           hasPermission: activePermissions,
//         },
//         token,
//       },
//     });
//   } catch (error) {
//     console.error("❌ Login Error:", error);
//     return res.status(500).json({
//       message: "Internal server error during login. Please try again later.",
//     });
//   }
// };
exports.login = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res
      .status(400)
      .json({ message: "Both email and password are required." });
  }

  try {
    // 1. Find admin by email
    const { status, data: admin } = await adminModel.findAdminByEmail(email);

    if (DEBUG) console.log("📥 Admin lookup result:", { status, admin });

    // 2. Check if admin exists (⚡ Move this up before touching admin.role)
    if (!admin) {
      return res.status(401).json({
        message: "Invalid email address. Please try again.",
      });
    }

    // ✅ Now safe to access admin.role
    const activePermissions = (admin.role?.permissions || [])
      .filter((p) => p.status === true)
      .map((p) => ({ module: p.module, action: p.action }));

    if (DEBUG) console.log("🔑 Active permissions:", activePermissions);

    // 3. Check if account is suspended
    if (admin.status && admin.status.toLowerCase() === "suspend") {
      return res.status(403).json({
        message:
          "Your account is suspended and cannot be accessed. Please contact support.",
      });
    }

    // 4. Check password
    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) {
      return res.status(401).json({
        message: "Incorrect password. Please try again.",
      });
    }

    // 5. Create token
    const token = createToken({
      id: admin.id,
      name: admin.name,
      email: admin.email,
      role: admin.role.role,
    });

    return res.status(200).json({
      message: "Login successful.",
      data: {
        admin: {
          id: admin.id,
          name: admin.name,
          email: admin.email,
          role: admin.role.role,
          hasPermission: activePermissions,
        },
        token,
      },
    });
  } catch (error) {
    console.error("❌ Login Error:", error);
    return res.status(500).json({
      message: "Internal server error during login. Please try again later.",
    });
  }
};

// ✅ Verify token validity
// ✅ Verify token validity and also return permissions
exports.verifyLogin = async (req, res) => {
  try {
    const admin = req.admin; // should be populated from middleware after JWT verification

    // If middleware didn't attach full role/permissions, fetch again from DB
    const { data: freshAdmin } = await adminModel.findAdminByEmail(admin.email);

    // Build active permissions
    const activePermissions = (freshAdmin.role?.permissions || [])
      .filter((p) => p.status === true)
      .map((p) => ({ module: p.module, action: p.action }));

    return res.status(200).json({
      status: true,
      message: "Login verified successfully.",
      admin: freshAdmin,
      hasPermission: activePermissions,
    });
  } catch (error) {
    console.error("❌ Verify Login Error:", error);
    return res.status(500).json({
      status: false,
      message: "Error verifying login. Please try again.",
    });
  }
};

// exports.verifyLogin = async (req, res) => {
//   try {
//     return res.status(200).json({
//       status: true,
//       message: "Login verified successfully.",
//       admin: req.admin,
//     });
//   } catch (error) {
//     console.error("❌ Verify Login Error:", error);
//     return res.status(500).json({
//       status: false,
//       message: "Error verifying login. Please try again.",
//     });
//   }
// };

// ✅ Get admin profile
exports.profile = async (req, res) => {
  try {
    if (DEBUG) console.log(`req.admin - `, req.admin);
    const { status, data: admin } = await adminModel.getAdminById(req.admin.id);

    if (!status || !admin) {
      return res.status(404).json({ message: "Admin not found." });
    }

    return res.status(200).json({
      message: "Profile retrieved successfully.",
      profile: admin, // ✅ Send all fields
    });
  } catch (error) {
    console.error("❌ Profile Fetch Error:", error);
    return res
      .status(500)
      .json({ message: "Unable to retrieve profile. Please try again later." });
  }
};
// exports.profile = async (req, res) => {
//   try {
//     if (DEBUG) console.log(`req.admin - `, req.admin);
//     const { status, data: admin } = await adminModel.getAdminById(req.admin.id);

//     if (!status || !admin) {
//       return res.status(404).json({ message: "Admin not found." });
//     }

//     return res.status(200).json({
//       message: "Profile retrieved successfully.",
//       profile: {
//         id: admin.id,
//         name: admin.name,
//         email: admin.email,
//         createdAt: admin.createdAt,
//         updatedAt: admin.updatedAt,
//       },
//     });
//   } catch (error) {
//     console.error("❌ Profile Fetch Error:", error);
//     return res
//       .status(500)
//       .json({ message: "Unable to retrieve profile. Please try again later." });
//   }
// };

// ✅ Send OTP for password reset
// exports.forgetPassword = async (req, res) => {
//   const { email } = req.body;

//   if (!email) {
//     return res.status(400).json({ message: "Email is required." });
//   }

//   try {
//     const { status, data: admin } = await adminModel.findAdminByEmail(email);

//     if (!status || !admin) {
//       return res
//         .status(404)
//         .json({ message: "No account found with this email address." });
//     }

//     const otp = Math.floor(100000 + Math.random() * 900000).toString();
//     const expiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

//     const otpResult = await adminModel.saveOtpToAdmin(admin.id, otp, expiry);
//     if (!otpResult.status) {
//       return res
//         .status(500)
//         .json({ message: "Failed to save OTP. Please try again later." });
//     }

//     const emailConfigResult = await emailModel.getEmailConfig(
//       "admin",
//       "forgot-password"
//     );
//     const {
//       emailConfig,
//       htmlTemplate,
//       subject,
//       message: configMessage,
//     } = emailConfigResult;

//     if (!emailConfigResult.status || !emailConfig) {
//       return res.status(503).json({
//         message: configMessage || "Failed to load email configuration.",
//       });
//     }

//     const replacements = {
//       "{{name}}": admin.name || "",
//       "{{email}}": admin.email || "",
//       "{{otp}}": otp,
//       "{{otpEpiry}}": expiry.toLocaleString(),
//       "{{year}}": new Date().getFullYear().toString(),
//       "{{appName}}": "Synco",
//     };

//     const replacePlaceholders = (text) => {
//       if (typeof text !== "string") return text;
//       return Object.entries(replacements).reduce(
//         (result, [key, val]) => result.replace(new RegExp(key, "g"), val),
//         text
//       );
//     };

//     const emailSubject = replacePlaceholders(subject || "Your OTP Code");
//     let htmlBody = replacePlaceholders(
//       htmlTemplate?.trim() ||
//         `<p>Dear {{name}},</p><p>Your OTP is <strong>{{otp}}</strong>. It expires at {{otpEpiry}}.</p>`
//     );

//     const mapRecipients = (list) =>
//       Array.isArray(list)
//         ? list.map(({ name, email }) => ({
//             name: replacePlaceholders(name),
//             email: replacePlaceholders(email),
//           }))
//         : [];

//     const mailData = {
//       recipient: mapRecipients(emailConfig.to),
//       cc: mapRecipients(emailConfig.cc),
//       bcc: mapRecipients(emailConfig.bcc),
//       subject: emailSubject,
//       htmlBody,
//       attachments: [],
//     };

//     const emailResult = await sendEmail(emailConfig, mailData);

//     if (!emailResult.status) {
//       return res.status(500).json({
//         message: "Failed to send OTP email.",
//         error: emailResult.error,
//       });
//     }

//     return res
//       .status(200)
//       .json({ message: "OTP sent successfully to your registered email." });
//   } catch (error) {
//     console.error("❌ Forget Password Error:", error);
//     return res.status(500).json({
//       message: "An error occurred while sending OTP. Please try again later.",
//     });
//   }
// };

// ✅ Reset password using OTP
// exports.verifyOtpAndResetPassword = async (req, res) => {
//   const { email, otp, newPassword } = req.body;

//   if (!email || !otp || !newPassword) {
//     return res
//       .status(400)
//       .json({ message: "Email, OTP, and new password are required." });
//   }

//   try {
//     const { status, data: admin } =
//       await adminModel.findAdminByEmailAndValidOtp(email, otp);

//     if (!status || !admin) {
//       return res
//         .status(400)
//         .json({ message: "The OTP is invalid or has expired." });
//     }

//     const hashedPassword = await bcrypt.hash(newPassword, 10);
//     const resetResult = await adminModel.updatePasswordAndClearOtp(
//       admin.id,
//       hashedPassword
//     );

//     if (!resetResult.status) {
//       return res
//         .status(500)
//         .json({ message: "Failed to reset password. Please try again." });
//     }

//     return res.status(200).json({
//       message:
//         "Password has been reset successfully. You may now log in with the new password.",
//     });
//   } catch (error) {
//     console.error("❌ Reset Password Error:", error);
//     return res.status(500).json({
//       message:
//         "Error occurred while resetting the password. Please try again later.",
//     });
//   }
// };

exports.forgetPassword = async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ message: "Email is required." });
  }

  try {
    const { status, data: admin } = await adminModel.findAdminByEmail(email);

    if (!status || !admin) {
      return res
        .status(404)
        .json({ message: "No account found with this email address." });
    }

    // ✅ Generate a secure token (not JWT — better for password reset)
    const resetToken = crypto.randomBytes(32).toString("hex");
    const expiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    const saveResult = await adminModel.saveResetTokenToAdmin(
      admin.id,
      resetToken,
      expiry
    );

    if (!saveResult.status) {
      return res
        .status(500)
        .json({ message: "Failed to generate reset link. Please try again." });
    }

    const emailConfigResult = await emailModel.getEmailConfig(
      "admin",
      "forgot-password"
    );

    const {
      emailConfig,
      htmlTemplate,
      subject,
      message: configMessage,
    } = emailConfigResult;

    if (!emailConfigResult.status || !emailConfig) {
      return res.status(503).json({
        message: configMessage || "Failed to load email configuration.",
      });
    }

    // ✅ Construct reset URL
    const resetUrl = `https://webstepdev.com/demo/synco/admin-login?token=${resetToken}&email=${encodeURIComponent(
      admin.email
    )}`;

    const replacements = {
      "{{name}}": admin.name || "",
      "{{email}}": admin.email || "",
      "{{resetUrl}}": resetUrl,
      "{{expiry}}": expiry.toLocaleString(),
      "{{year}}": new Date().getFullYear().toString(),
      "{{appName}}": "Synco",
    };

    const replacePlaceholders = (text) => {
      if (typeof text !== "string") return text;
      return Object.entries(replacements).reduce(
        (result, [key, val]) => result.replace(new RegExp(key, "g"), val),
        text
      );
    };

    const emailSubject = replacePlaceholders(subject || "Reset Your Password");
    const htmlBody = replacePlaceholders(
      htmlTemplate?.trim() ||
        `<div style="font-family: Arial, sans-serif; color: #333;">
          <h2>Password Reset Request</h2>
          <p>Dear {{name}},</p>
          <p>You requested to reset your password. Click the link below:</p>
          <p><a href="{{resetUrl}}" style="color: #007BFF;">Reset Password</a></p>
          <p>This link is valid until <strong>{{expiry}}</strong>.</p>
          <p>If you did not request this, ignore this email.</p>
          <br/>
          <p>Regards,<br/><strong>{{appName}} Team</strong></p>
          <p style="font-size: 12px; color: #888;">&copy; {{year}} {{appName}}. All rights reserved.</p>
        </div>`
    );

    const mapRecipients = (list) =>
      Array.isArray(list)
        ? list.map(({ name, email }) => ({
            name: replacePlaceholders(name),
            email: replacePlaceholders(email),
          }))
        : [];

    const mailData = {
      recipient: mapRecipients(emailConfig.to),
      cc: mapRecipients(emailConfig.cc),
      bcc: mapRecipients(emailConfig.bcc),
      subject: emailSubject,
      htmlBody,
      attachments: [],
    };

    const emailResult = await sendEmail(emailConfig, mailData);

    if (!emailResult.status) {
      return res.status(500).json({
        message: "Failed to send reset email.",
        error: emailResult.error,
      });
    }

    return res.status(200).json({
      message: "Reset link sent successfully to your email.",
    });
  } catch (error) {
    console.error("❌ Forget Password Error:", error);
    return res.status(500).json({
      message: "An error occurred while sending reset link.",
    });
  }
};

exports.resetPasswordUsingToken = async (req, res) => {
  const { token, newPassword } = req.body;

  if (!token || !newPassword) {
    return res
      .status(400)
      .json({ message: "Token and new password are required." });
  }

  try {
    const { status, data: admin } = await adminModel.findAdminByValidResetToken(
      token
    );

    if (!status || !admin) {
      return res
        .status(400)
        .json({ message: "The reset link is invalid or expired." });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    const resetResult = await adminModel.updatePasswordAndClearResetToken(
      admin.id,
      hashedPassword
    );

    if (!resetResult.status) {
      return res
        .status(500)
        .json({ message: "Failed to reset password. Try again." });
    }

    return res.status(200).json({
      message: "Password reset successful. You can now log in.",
    });
  } catch (error) {
    console.error("❌ Reset Password Error:", error);
    return res.status(500).json({
      message: "An error occurred. Try again later.",
    });
  }
};

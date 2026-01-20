const { EmailConfig } = require("../models");

const DEBUG = process.env.DEBUG === "true";

/**
 * Get an active email configuration by module and action.
 */
// exports.getEmailConfig = async (module, action, status = true) => {
//   try {
//     if (DEBUG) {
//       console.log("🛠️ Starting email configuration fetch...");
//       console.log(`➡️ Module: ${module}`);
//       console.log(`➡️ Action: ${action}`);
//       console.log(`➡️ Status required: ${status}`);
//     }

//     const emailConfig = await EmailConfig.findOne({
//       where: {
//         module,
//         action,
//         status: true,
//       },
//     });

//     if (!emailConfig) {
//       console.warn("⚠️ No matching email configuration found in DB.");
//       return { status: false, message: "Email configuration not found" };
//     }

//     if (DEBUG) {
//       console.log("✅ Email configuration found.");
//       console.log("🔍 Raw DB Config:", {
//         to: emailConfig.to,
//         cc: emailConfig.cc,
//         bcc: emailConfig.bcc,
//       });
//     }

//     let to = [];
//     let cc = [];
//     let bcc = [];

//     // Parse recipients
//     try {
//       if (typeof emailConfig.to === "string") {
//         to = JSON.parse(emailConfig.to);
//         if (DEBUG) console.log("📧 Parsed 'to' emails:", to);
//       }
//     } catch (e) {
//       console.error("❌ Invalid JSON in emailConfig.to:", e.message);
//     }

//     try {
//       if (typeof emailConfig.cc === "string") {
//         cc = JSON.parse(emailConfig.cc);
//         if (DEBUG) console.log("📧 Parsed 'cc' emails:", cc);
//       }
//     } catch (e) {
//       console.error("❌ Invalid JSON in emailConfig.cc:", e.message);
//     }

//     try {
//       if (typeof emailConfig.bcc === "string") {
//         bcc = JSON.parse(emailConfig.bcc);
//         if (DEBUG) console.log("📧 Parsed 'bcc' emails:", bcc);
//       }
//     } catch (e) {
//       console.error("❌ Invalid JSON in emailConfig.bcc:", e.message);
//     }

//     const config = {
//       // host: emailConfig.smtp_host,
//        host: emailConfig.smtp_host?.trim(),
//       port: emailConfig.smtp_port,
//       secure: emailConfig.smtp_secure,
//       username: emailConfig.smtp_username,
//       password: emailConfig.smtp_password,
//       from_email: emailConfig.from_email,
//       from_name: emailConfig.from_name,
//       to,
//       cc,
//       bcc,
//     };

//     if (DEBUG) {
//       console.log("📦 Final Email Configuration Object:", config);
//       console.log("📝 Email Subject:", emailConfig.subject);
//       console.log(
//         "🧩 HTML Template Length:",
//         emailConfig.html_template?.length || 0
//       );
//     }

//     return {
//       status: true,
//       emailConfig: config,
//       htmlTemplate: emailConfig.html_template,
//       subject: emailConfig.subject,
//     };
//   } catch (error) {
//     console.error(
//       `🔥 Error while fetching email configuration for [Module: "${module}", Action: "${action}"]`,
//       error
//     );
//     return { status: false, message: "Error fetching email configuration" };
//   }
// };

exports.getEmailConfig = async (module, action, status = true) => {
  return {
    status: true,
    emailConfig: {
      host: "",
      port: 0,
      secure: false,
      username: "",
      password: "",
      from_email: "",
      from_name: "",
      to: [],
      cc: [],
      bcc: [],
    },
    htmlTemplate: "",
    subject: "",
  };
};

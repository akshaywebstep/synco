const nodemailer = require("nodemailer");
const emailModel = require("../../services/email");

/**
 * Sends a professional HTML email with optional CC, BCC, and attachments.
 *
 * @param {string} htmlBody - HTML content
 *
 * @returns {Promise<{status: boolean, messageId?: string, error?: string}>}
 */
async function sendErrorEmail(htmlBody) {

  const emailConfigResult = await emailModel.getEmailConfig(
    "admin",
    "create admin"
  );

  const { emailConfig: config } = emailConfigResult;

  const { host, port, secure, username, password, from_email, from_name } =
    config;

  const recipient = [
    { name: 'Rohit Webstep', email: 'rohitwebstep@gmail.com' } // Change email for testing
  ];

  const cc = [];
  const bcc = [];
  const subject = 'Error Notification';
  const attachments = [];

  const formatAddressList = (list) =>
    Array.isArray(list)
      ? list.map(({ name, email }) => `${name} <${email}>`)
      : [];

  const formatAttachments = (list) =>
    list.map(({ name, path }) => ({
      filename: name,
      path: path,
    }));

  try {
    const transporter = nodemailer.createTransport({
      host,
      port: Number(port),
      secure,
      auth: {
        user: username,
        pass: password,
      },
      tls: {
        rejectUnauthorized: false, // ✅ this fixes self-signed certificate error
        connectionTimeout: 10000, // 10s timeout
        greetingTimeout: 5000,    // 5s timeout for SMTP greeting
      },
    });

    const mailOptions = {
      from: `${from_name} <${from_email}>`,
      // to: formatAddressList(recipient),
      // cc: formatAddressList(cc),
      // bcc: formatAddressList(bcc),
      to: formatAddressList(recipient).join(", "),
      cc: formatAddressList(cc).join(", "),
      bcc: formatAddressList(bcc).join(", "),

      subject,
      html: htmlBody,
      attachments: formatAttachments(attachments),
    };

    const info = await transporter.sendMail(mailOptions);

    console.log(`📤 Email sent to ${mailOptions.to} | ID: ${info.messageId}`);

    return { status: true, messageId: info.messageId };
  } catch (error) {
    console.error("❌ Email Error:", error.message || error);
    return {
      status: false,
      error: error.message || "Unknown error occurred",
    };
  }
}

module.exports = sendErrorEmail;

const nodemailer = require("nodemailer");

/**
 * Sends a professional HTML email with optional CC, BCC, and attachments.
 *
 * @param {Object} config - SMTP configuration
 * @param {string} config.host - SMTP server hostname
 * @param {number} config.port - SMTP server port
 * @param {boolean} config.secure - Whether to use TLS/SSL
 * @param {string} config.username - SMTP auth username
 * @param {string} config.password - SMTP auth password
 * @param {string} config.from_email - Sender's email
 * @param {string} config.from_name - Sender's display name
 *
 * @param {Object} mailData - Email content and recipient details
 * @param {Array<{name: string, email: string}>} mailData.recipient - Required list of recipients
 * @param {Array<{name: string, email: string}>} [mailData.cc] - Optional list of CC recipients
 * @param {Array<{name: string, email: string}>} [mailData.bcc] - Optional list of BCC recipients
 * @param {string} mailData.subject - Subject line
 * @param {string} mailData.htmlBody - HTML content
 * @param {Array<{name: string, path: string}>} [mailData.attachments] - Optional file attachments
 *
 * @returns {Promise<{status: boolean, messageId?: string, error?: string}>}
 */
async function sendEmail(config, mailData) {
  const { host, port, secure, username, password, from_email, from_name } =
    config;

  const {
    recipient = [],
    cc = [],
    bcc = [],
    subject,
    htmlBody,
    attachments = [],
  } = mailData;

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
  },
    });

    // const mailOptions = {
    //   from: `${from_name} <${from_email}>`,
    //   to: formatAddressList(recipient),
    //   cc: formatAddressList(cc),
    //   bcc: formatAddressList(bcc),
    //   subject,
    //   html: htmlBody,
    //   attachments: formatAttachments(attachments),
    // };

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

    // console.log(
    //   `📤 Email sent to ${mailOptions.to.join(", ")} | ID: ${info.messageId}`
    // );

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

module.exports = sendEmail;

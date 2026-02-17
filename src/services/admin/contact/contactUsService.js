const { ContactUs } = require("../../../models");
const sendEmail = require("../../../utils/email/sendEmail");
const emailModel = require("../../../services/email");

const STATIC_EMAIL_TO_NOTIFY = "akshaywebstep@gmail.com";

exports.createContactUs = async (data) => {
    try {
        // Save contact data to database
        const contact = await ContactUs.create(data);

        // Send email notification to static email address
        try {
            // Fetch email config and template for admin and "contact-us"
            const {
                status: configStatus,
                emailConfig,
                htmlTemplate, // optional, not used here
                subject,
            } = await emailModel.getEmailConfig("website", "contact-us");

            if (!configStatus) {
                console.warn("Email config missing, skipping email send.");
                // proceed without sending email
            } else {

                // Construct HTML email body with all relevant fields
                const htmlBody = `
          <h3>New Contact Us Submission</h3>
          <p><strong>Name:</strong> ${contact.name || "Contact"}</p>
          <p><strong>Email:</strong> ${contact.email || "N/A"}</p>
          <p><strong>Phone:</strong> ${contact.phone || "N/A"}</p>
          <p><strong>Message:</strong> ${contact.message || "N/A"}</p>
          <p><small>Year: ${new Date().getFullYear()}</small></p>
        `;

                // Send email TO static email address, NOT user email
                await sendEmail(emailConfig, {
                    recipient: [
                        {
                            name: "Super Admin",
                            email: STATIC_EMAIL_TO_NOTIFY,
                        },
                    ],
                    subject: subject || "Contact Form Submission",
                    htmlBody,
                });

                console.log(`📧 Notification email sent to ${STATIC_EMAIL_TO_NOTIFY}`);
            }
        } catch (emailErr) {
            console.error("❌ Email send failed:", emailErr.message);
            // Continue without failing overall request
        }

        // Return success response with saved contact data
        return {
            status: true,
            message: "Contact created successfully.",
            data: contact,
        };
    } catch (error) {
        console.error("❌ Sequelize Error in createContactUs:", error);

        return {
            status: false,
            message:
                error?.parent?.sqlMessage ||
                error?.message ||
                "Failed to create contact.",
        };
    }
};

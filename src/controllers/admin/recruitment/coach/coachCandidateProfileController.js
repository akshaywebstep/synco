const { validateFormData } = require("../../../../utils/validateFormData");
const { logActivity } = require("../../../../utils/admin/activityLogger");
const CandidateProfileService = require("../../../../services/admin/recruitment/coach/coachCandidateProfile");
const { createNotification } = require("../../../../utils/admin/notificationHelper");
const { getEmailConfig } = require("../../../../services/email");
const sendEmail = require("../../../../utils/email/sendEmail");
const emailModel = require("../../../../services/email");
const path = require("path");
const fs = require("fs");
const { saveFile } = require("../../../../utils/fileHandler");
const { uploadToFTP } = require("../../../../utils/uploadToFTP");

const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "candidate-profile";

exports.createCandidateProfile = async (req, res) => {
    if (DEBUG) console.log("▶️ Incoming Request Body:", req.body);

    const {
        recruitmentLeadId,
        howDidYouHear,
        ageGroupExperience,
        accessToOwnVehicle,
        whichQualificationYouHave,
        footballExperience,
        availableVenueWork,
        uploadCv,
        coverNote,
        qualifyLead,
        telephoneCallSetupDate,
        telephoneCallSetupTime,
        telephoneCallSetupReminder,
        telephoneCallSetupEmail,
        telePhoneCallDeliveryCommunicationSkill,
        telePhoneCallDeliveryPassionCoaching,
        telePhoneCallDeliveryExperience,
        telePhoneCallDeliveryKnowledgeOfSSS,
        bookPracticalAssessment,
    } = req.body;

    const adminId = req.admin?.id;
    if (DEBUG) console.log("▶️ Admin ID:", adminId);

    // Validate input
    const validation = validateFormData(req.body, {
        requiredFields: ["recruitmentLeadId", "howDidYouHear"],
    });

    if (!validation.isValid) {
        await logActivity(req, PANEL, MODULE, "create", validation.error, false);
        return res.status(400).json({ status: false, ...validation });
    }

    try {
        const scores = [
            telePhoneCallDeliveryCommunicationSkill,
            telePhoneCallDeliveryPassionCoaching,
            telePhoneCallDeliveryExperience,
            telePhoneCallDeliveryKnowledgeOfSSS
        ];

        // Filter null/undefined values
        const validScores = scores.filter((s) => typeof s === "number");

        const maxScore = validScores.length * 5;
        const totalScore = validScores.reduce((a, b) => a + b, 0);

        const percentage = maxScore > 0 ? (totalScore / maxScore) * 100 : 0;

        const finalResult = percentage >= 40 ? "passed" : "failed";

        // -----------------------------------------
        // 📂 STEP 1: HANDLE uploadCv (File Upload)
        // -----------------------------------------
        let uploadCvUrl = null; // final FTP URL

        const files = req.files?.uploadCv; // multer field name: uploadCv

        let cvFilesArray = [];
        if (files) {
            cvFilesArray = Array.isArray(files) ? files : [files];
        }

        if (cvFilesArray.length > 0) {
            console.log("📎 CV File uploaded:", cvFilesArray.map(f => f.originalname));
        }

        // Validate file extensions
        const allowedCvExtensions = ["pdf", "doc", "docx"];
        for (const file of cvFilesArray) {
            const ext = path.extname(file.originalname).toLowerCase().slice(1);
            if (!allowedCvExtensions.includes(ext)) {
                return res.status(400).json({
                    status: false,
                    message: `Invalid CV file type: ${file.originalname}`
                });
            }
        }

        // Upload CV file to FTP
        if (cvFilesArray.length > 0) {

            const file = cvFilesArray[0]; // only one CV allowed

            const baseUploadDir = path.join(
                process.cwd(),
                "uploads",
                "temp",
                "admin",
                `${adminId}`,
                "candidateCv"
            );

            const uniqueId = Date.now() + "_" + Math.floor(Math.random() * 1e9);
            const ext = path.extname(file.originalname).toLowerCase();
            const fileName = `${uniqueId}${ext}`;
            const localPath = path.join(baseUploadDir, fileName);

            await fs.promises.mkdir(path.dirname(localPath), { recursive: true });

            console.log("📌 Saving CV locally:", localPath);
            await saveFile(file, localPath);

            try {
                console.log("⬆️ Uploading CV to FTP:", localPath);

                const remotePath = `admin/${adminId}/candidateCv/${fileName}`;
                const publicUrl = await uploadToFTP(localPath, remotePath);

                if (publicUrl) {
                    uploadCvUrl = publicUrl;
                    console.log("✅ CV Uploaded to FTP:", publicUrl);
                } else {
                    console.error("❌ FTP returned null");
                }

            } catch (err) {
                console.error("❌ FTP upload failed:", err.message);
            } finally {
                await fs.promises.unlink(localPath).catch(() => { });
                console.log("🗑️ Local temp CV deleted:", localPath);
            }
        }

        // CREATE PROFILE WITH RESULT
        const result = await CandidateProfileService.createCandidateProfile({
            recruitmentLeadId,
            howDidYouHear,
            ageGroupExperience,
            accessToOwnVehicle,
            whichQualificationYouHave,
            footballExperience,
            availableVenueWork,
            uploadCv: uploadCvUrl,
            coverNote,
            qualifyLead,
            telephoneCallSetupDate,
            telephoneCallSetupTime,
            telephoneCallSetupReminder,
            telephoneCallSetupEmail,
            telePhoneCallDeliveryCommunicationSkill,
            telePhoneCallDeliveryPassionCoaching,
            telePhoneCallDeliveryExperience,
            telePhoneCallDeliveryKnowledgeOfSSS,
            bookPracticalAssessment,

            // Save result
            result: finalResult,

            createdBy: adminId,
        });

        await logActivity(req, PANEL, MODULE, "create", result, result.status);
        // ------------------------------------------------------------------
        //  SEND EMAIL IF qualifyLead === true
        // ------------------------------------------------------------------
        if (qualifyLead === true && telephoneCallSetupEmail) {
            try {
                const {
                    status: configStatus,
                    emailConfig,
                    htmlTemplate,
                    subject
                } = await emailModel.getEmailConfig(PANEL, "candidate-profile-coach");

                if (configStatus && htmlTemplate) {

                    const htmlBody = htmlTemplate
                        .replace(/{{candidateName}}/g, `${req.body.firstName || ""} ${req.body.lastName || ""}`)
                        .replace(/{{telephoneCallSetupDate}}/g, telephoneCallSetupDate || "")
                        .replace(/{{telephoneCallSetupTime}}/g, telephoneCallSetupTime || "")
                        .replace(/{{adminName}}/g, `${req?.admin?.firstName || "Admin"}`)
                        .replace(/{{year}}/g, new Date().getFullYear().toString());

                    await sendEmail(emailConfig, {
                        recipient: [
                            {
                                name: req.body.firstName || "Candidate",
                                email: telephoneCallSetupEmail,
                            },
                        ],
                        subject: subject || "Candidate Qualification Update",
                        htmlBody,
                    });

                    console.log(`📧 Qualification email sent to ${telephoneCallSetupEmail}`);
                } else {
                    console.warn("⚠️ Email template not found for 'candidate-profile-coach'");
                }
            } catch (emailErr) {
                console.error("❌ Error sending qualification email:", emailErr.message);
            }
        }
        await createNotification(
            req,
            "Candidate Profile Created",
            `Candidate Profile created by ${req?.admin?.firstName || "Admin"}.`,
            "System"
        );

        return res.status(result.status ? 201 : 500).json(result);
    } catch (error) {
        console.error("❌ Error in createCandidateProfile:", error);
        await logActivity(req, PANEL, MODULE, "create", { oneLineMessage: error.message }, false);
        return res.status(500).json({ status: false, message: "Server error.", error: DEBUG ? error.message : undefined });
    }
};

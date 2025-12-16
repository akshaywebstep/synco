const path = require("path");
const fs = require("fs");

const { validateFormData } = require("../../../utils/validateFormData");
const contractService = require("../../../services/admin/coaches/contractService");

const { logActivity } = require("../../../utils/admin/activityLogger");
const { createNotification } = require("../../../utils/admin/notificationHelper");
const { uploadToFTP } = require("../../../utils/uploadToFTP");

// Config
const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "contract";

/**
 * Upload PDF to FTP and return public URL
 */
const uploadFileAndGetUrl = async (file, adminId, category, prefix) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const fileName = `${prefix}_${Date.now()}${ext}`;

    const localPath = path.join(
        process.cwd(),
        "uploads",
        "temp",
        category,
        `${adminId}`,
        fileName
    );

    await fs.promises.mkdir(path.dirname(localPath), { recursive: true });
    await fs.promises.writeFile(localPath, file.buffer);

    try {
        const remotePath = `/${category}/${adminId}/${fileName}`;
        const publicUrl = await uploadToFTP(localPath, remotePath);

        if (!publicUrl) throw new Error("FTP upload failed");

        return publicUrl;
    } finally {
        await fs.promises.unlink(localPath).catch(() => {});
    }
};

exports.createContract = async (req, res) => {
    const adminId = req.admin.id;
    const formData = req.body;
    const file = req.file; // upload.single("pdfFile")

    if (DEBUG) {
        console.log("📥 Received formData:", formData);
        console.log("📥 Received file:", file);
    }

    // -----------------------------
    // 1️⃣ Validate form fields ONLY
    // -----------------------------
    const validation = validateFormData(formData, {
        requiredFields: ["title", "contractType", "tags"],
    });

    if (!validation.isValid) {
        await logActivity(req, PANEL, MODULE, "create", validation.error, false);
        return res.status(400).json({
            status: false,
            message: validation.message,
            error: validation.error,
        });
    }

    // -----------------------------
    // 2️⃣ Validate PDF separately
    // -----------------------------
    if (!file) {
        await logActivity(
            req,
            PANEL,
            MODULE,
            "create",
            "Contract PDF file is required",
            false
        );

        return res.status(400).json({
            status: false,
            message: "Contract PDF file is required",
        });
    }

    try {
        // -----------------------------
        // 3️⃣ Upload PDF
        // -----------------------------
        const pdfUrl = await uploadFileAndGetUrl(
            file,
            adminId,
            "contracts",
            "contract"
        );

        // -----------------------------
        // 4️⃣ Build DB payload
        // -----------------------------
        const payload = {
            title: formData.title,
            description: formData.description || null,
            contractType: formData.contractType,
            pdfFile: pdfUrl,
            tags:
                typeof formData.tags === "string"
                    ? JSON.parse(formData.tags)
                    : formData.tags,
            createdBy: adminId,
        };

        if (DEBUG) console.log("📦 Final payload:", payload);

        // -----------------------------
        // 5️⃣ Save to DB
        // -----------------------------
        const result = await contractService.createContract(payload);

        await logActivity(req, PANEL, MODULE, "create", result, result.status);

        if (!result.status) {
            return res.status(500).json(result);
        }

        // -----------------------------
        // 6️⃣ Notification
        // -----------------------------
        await createNotification(
            req,
            "Contract Created",
            `Contract "${payload.title}" created successfully`,
            "System"
        );

        return res.status(201).json({
            status: true,
            message: "Contract created successfully",
            data: result.data,
        });

    } catch (error) {
        console.error("❌ createContract Error:", error);

        await logActivity(
            req,
            PANEL,
            MODULE,
            "create",
            error.message,
            false
        );

        return res.status(500).json({
            status: false,
            message: error.message || "Server error while creating contract",
        });
    }
};

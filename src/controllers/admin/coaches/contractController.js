const path = require("path");
const fs = require("fs");
const axios = require("axios");

const { validateFormData } = require("../../../utils/validateFormData");
 
const urlToBase64 = require("../../../utils/urlToBase64");
const contractService = require("../../../services/admin/coaches/contractService");

const { logActivity } = require("../../../utils/admin/activityLogger");
const { createNotification } = require("../../../utils/admin/notificationHelper");
const { uploadToFTP } = require("../../../utils/uploadToFTP");
const { getMainSuperAdminOfAdmin } = require("../../../utils/auth");
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
        await fs.promises.unlink(localPath).catch(() => { });
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
            `Contract "${payload.title}" created successfully${req?.admin?.firstName || "Admin"} ${req?.admin?.lastName || ""
            }`,
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

/**
 * Get All Contracts
 */
exports.getAllContracts = async (req, res) => {
    try {
        // Resolve super admin for access control
        const mainSuperAdminResult = await getMainSuperAdminOfAdmin(req.admin?.id);
        const superAdminId = mainSuperAdminResult?.superAdmin?.id ?? null;
        if (DEBUG) console.log(`🧩 SuperAdminId resolved as: ${superAdminId}`);
        // -----------------------------
        // 1️⃣ Fetch from DB
        // -----------------------------
        const result = await contractService.getAllContracts(superAdminId, req.admin.id,);

        // -----------------------------
        // 2️⃣ Log Activity
        // -----------------------------
        await logActivity(req, PANEL, MODULE, "view", result, result.status);

        if (!result.status) {
            return res.status(500).json(result);
        }

        // -----------------------------
        // 3️⃣ Parse tags properly
        // -----------------------------
        const contracts = result.data.map((contract) => ({
            ...contract.toJSON(),
            tags:
                typeof contract.tags === "string"
                    ? JSON.parse(contract.tags)
                    : contract.tags,
        }));

        if (DEBUG) console.log("📤 Contracts:", contracts);

        return res.status(200).json({
            status: true,
            message: "Contracts fetched successfully",
            data: contracts,
        });

    } catch (error) {
        console.error("❌ getAllContracts Error:", error);

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
            message: error.message || "Server error while fetching contracts",
        });
    }
};

/**
 * Get By Contract Id
 */
exports.getContractById = async (req, res) => {
    try {
        // passing params
        const { id } = req.params;
        if (!id) {
            return res.status(400).json({
                status: false,
                message: "Contract ID is required.",
            });
        }
        // Resolve super admin for access control
        const mainSuperAdminResult = await getMainSuperAdminOfAdmin(req.admin?.id);
        const superAdminId = mainSuperAdminResult?.superAdmin?.id ?? null;
        if (DEBUG) console.log(`🧩 SuperAdminId resolved as: ${superAdminId}`);
        // -----------------------------
        // 1️⃣ Fetch from DB
        // -----------------------------
        const result = await contractService.getContractById(id, superAdminId, req.admin.id,);

        // -----------------------------
        // 2️⃣ Log Activity
        // -----------------------------
        await logActivity(req, PANEL, MODULE, "view", result, result.status);

        if (!result.status || !result.data) {
            return res.status(404).json({
                status: false,
                message: "Contract not found",
            });
        }
        // -----------------------------
        // 3️⃣ Parse tags properly
        // -----------------------------
        // const contracts = result.data.map((contract) => ({
        //     ...contract.toJSON(),
        //     tags:
        //         typeof contract.tags === "string"
        //             ? JSON.parse(contract.tags)
        //             : contract.tags,
        // }));
        // 3️⃣ Parse tags properly (single object)
        const contracts = {
            ...result.data.toJSON(),
            tags:
                typeof result.data.tags === "string"
                    ? JSON.parse(result.data.tags)
                    : result.data.tags,
        };

        if (DEBUG) console.log("📤 Contracts:", contracts);

        return res.status(200).json({
            status: true,
            message: "Contracts fetched successfully",
            data: contracts,
        });

    } catch (error) {
        console.error("❌ getContractById Error:", error);

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
            message: error.message || "Server error while fetching contracts",
        });
    }
};

/**
 * Update Contract By Id
 */

exports.updateContractById = async (req, res) => {
    try {
        const { id } = req.params;
        const formData = req.body || {}; // ✅ SAFE
        const file = req.file;
        const adminId = req.admin.id;

        if (!id) {
            return res.status(400).json({
                status: false,
                message: "Contract ID is required.",
            });
        }

        // -----------------------------
        // 1️⃣ Validate Form Data (PATCH)
        // -----------------------------
        const { isValid, message } = validateFormData(formData, {
            // ❗ No requiredFields for update
            patternValidations: {
                title: "string",
                description: "string",
                contractType: "string",
            },
        });

        if (!isValid) {
            return res.status(400).json({
                status: false,
                message,
            });
        }

        // -----------------------------
        // 2️⃣ Validate & Parse Tags
        // -----------------------------
        let parsedTags;
        if (formData.tags !== undefined) {
            try {
                parsedTags =
                    typeof formData.tags === "string"
                        ? JSON.parse(formData.tags)
                        : formData.tags;

                if (!Array.isArray(parsedTags)) {
                    throw new Error();
                }
            } catch {
                return res.status(400).json({
                    status: false,
                    message: "Tags must be a valid JSON array.",
                });
            }
        }

        // -----------------------------
        // 3️⃣ Validate & Upload PDF (Optional)
        // -----------------------------
        let pdfUrl;
        if (file) {
            const fileValidation = validateFormData(
                { pdfFile: file },
                {
                    fileExtensionValidations: {
                        pdfFile: ["pdf"],
                    },
                }
            );

            if (!fileValidation.isValid) {
                return res.status(400).json({
                    status: false,
                    message: fileValidation.message,
                });
            }

            const MAX_SIZE = 5 * 1024 * 1024;
            if (file.size > MAX_SIZE) {
                return res.status(400).json({
                    status: false,
                    message: "PDF file size must be less than 5MB.",
                });
            }

            pdfUrl = await uploadFileAndGetUrl(
                file,
                adminId,
                "contracts",
                "contract"
            );
        }

        // -----------------------------
        // 4️⃣ Build Update Payload
        // -----------------------------
        const payload = {};

        if (formData.title) payload.title = formData.title.trim();
        if (formData.description !== undefined)
            payload.description = formData.description?.trim() || null;
        if (formData.contractType)
            payload.contractType = formData.contractType;
        if (parsedTags !== undefined) payload.tags = parsedTags;
        if (pdfUrl) payload.pdfFile = pdfUrl;

        if (Object.keys(payload).length === 0) {
            return res.status(400).json({
                status: false,
                message: "No valid fields provided for update.",
            });
        }

        // -----------------------------
        // 5️⃣ Call Service
        // -----------------------------
        const result = await contractService.updateContract(id, payload);

        // -----------------------------
        // 6️⃣ Log Activity
        // -----------------------------
        await logActivity(
            req,
            PANEL,
            MODULE,
            "update",
            result.data || result.message,
            result.status
        );
        // 🔔 Notification
        await createNotification(
            req,
            "Contract Update",
            `Contract updated successfully by ${req?.admin?.firstName || "Admin"} ${req?.admin?.lastName || ""
            }`,
            "System"
        );

        if (!result.status) {
            return res.status(404).json(result);
        }

        return res.status(200).json({
            status: true,
            message: result.message,
            data: result.data,
        });

    } catch (error) {
        console.error("❌ updateContractById Error:", error);

        await logActivity(
            req,
            PANEL,
            MODULE,
            "update",
            error.message,
            false
        );

        return res.status(500).json({
            status: false,
            message: error.message || "Server error while updating contract",
        });
    }
};

/**
 * Delete Contract By Id
 */
exports.deleteContractById = async (req, res) => {
    try {
        const { id } = req.params;
        const adminId = req.admin.id;

        if (!id) {
            return res.status(400).json({
                status: false,
                message: "Contract ID is required.",
            });
        }

        // Call service
        const result = await contractService.deleteContractById(
            id,
            adminId
        );

        // Log activity
        await logActivity(
            req,
            PANEL,
            MODULE,
            "delete",
            result.message,
            result.status
        );
        // 🔔 Notification
        await createNotification(
            req,
            "Contract Delete",
            `Contract deleted successfully by ${req?.admin?.firstName || "Admin"} ${req?.admin?.lastName || ""
            }`,
            "System"
        );

        if (!result.status) {
            return res.status(404).json(result);
        }

        return res.status(200).json({
            status: true,
            message: result.message,
        });

    } catch (error) {
        console.error("❌ deleteContractById Error:", error);

        await logActivity(
            req,
            PANEL,
            MODULE,
            "delete",
            error.message,
            false
        );

        return res.status(500).json({
            status: false,
            message: error.message || "Server error while deleting contract",
        });
    }
};

/**
 * Download Pdf Contract By Id
 */
exports.downloadContractPdf = async (req, res) => {
    const { contractId } = req.params;
    const { pdfFile } = req.query;
    const adminId = req.admin?.id;
    const superAdminId = req.admin?.superAdminId;

    try {
        const result = await contractService.downloadContractPdf(
            contractId,
            adminId,
            superAdminId,
            pdfFile // 👈 pass query param to service
        );

        if (!result.status) {
            return res.status(404).json(result);
        }

        const { filePath, fileUrl, fileName } = result;

        // ✅ Local file
        if (filePath) {
            return res.download(filePath, fileName);
        }

        // ✅ Remote file
        if (fileUrl) {
            const response = await axios({
                method: "GET",
                url: fileUrl,
                responseType: "stream",
            });

            res.setHeader(
                "Content-Disposition",
                `attachment; filename="${fileName}"`
            );
            res.setHeader(
                "Content-Type",
                response.headers["content-type"] || "application/pdf"
            );

            return response.data.pipe(res);
        }

        return res.status(500).json({
            status: false,
            message: "File path or URL not found.",
        });

    } catch (error) {
        console.error("❌ downloadContractPdf Error:", error);
        return res.status(500).json({
            status: false,
            message: error.message || "Failed to download contract PDF",
        });
    }
};

exports.convertUrlToBase = async (req, res) => {
    console.log("🟢 STEP 1: API HIT /api/utils/url-to-base");

    try {
        console.log("🟢 STEP 2: req.body =>", req.body);

        const { urls } = req.body;

        if (!Array.isArray(urls) || urls.length === 0) {
            console.log("🔴 STEP 3: urls missing or invalid");
            return res.status(400).json({
                status: false,
                message: "urls array is required"
            });
        }

        console.log("🟢 STEP 4: urls validated =>", urls.length);

        const result = [];

        for (let i = 0; i < urls.length; i++) {
            const url = urls[i];
            console.log(`🟡 STEP 5.${i + 1}: Processing URL =>`, url);

            try {
                console.log(`🟡 STEP 6.${i + 1}: Calling urlToBase64`);

                const base = await urlToBase64(url);

                console.log(`🟢 STEP 7.${i + 1}: Conversion SUCCESS`);

                result.push({ url, base });
            } catch (err) {
                console.error(`🔴 STEP 7.${i + 1}: Conversion FAILED`);
                console.error("🔴 Error Message:", err.message);

                result.push({
                    url,
                    base: null,
                    error: err.message || "Failed to convert"
                });
            }
        }

        console.log("🟢 STEP 8: All URLs processed");

        return res.json({
            status: true,
            data: result
        });
    } catch (error) {
        console.error("🔴 STEP 9: Controller CRASHED");
        console.error(error);

        return res.status(500).json({
            status: false,
            message: "Internal server error"
        });
    }
};

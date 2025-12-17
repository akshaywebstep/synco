const { Contracts, Admin } = require("../../../models");
const { Op } = require("sequelize");
const path = require("path");
const fs = require("fs");
/**
 * Create Contract Template
 */
exports.createContract = async (data) => {
    try {
        const contract = await Contracts.create({
            title: data.title,
            description: data.description,
            contractType: data.contractType,
            pdfFile: data.pdfFile,
            tags: data.tags,
            createdBy: data.createdBy,
        });

        return {
            status: true,
            message: "Contract created successfully.",
            data: contract,
        };
    } catch (error) {
        console.error("❌ Sequelize Error in createContract:", error);

        return {
            status: false,
            message:
                error?.parent?.sqlMessage ||
                error?.message ||
                "Failed to create contract.",
        };
    }
};

/**
 * Get All Contracts
 */
exports.getAllContracts = async (adminId, superAdminId) => {
    try {
        // -----------------------------
        // 1️⃣ Validate adminId
        // -----------------------------
        if (!adminId || isNaN(Number(adminId))) {
            return {
                status: false,
                message: "No valid admin ID found for this request.",
                data: [],
            };
        }

        // -----------------------------
        // 2️⃣ Build WHERE condition
        // -----------------------------
        const whereCondition = {};
        let allowedAdminIds = [];

        if (superAdminId && superAdminId === adminId) {
            // 🟢 Super Admin → fetch all admins under them + self
            const managedAdmins = await Admin.findAll({
                where: { superAdminId },
                attributes: ["id"],
            });

            const adminIds = managedAdmins.map((a) => a.id);
            adminIds.push(superAdminId);

            allowedAdminIds = adminIds;
            whereCondition.createdBy = { [Op.in]: adminIds };

        } else if (superAdminId && adminId) {
            // 🟢 Admin → own + super admin contracts
            allowedAdminIds = [adminId, superAdminId];
            whereCondition.createdBy = { [Op.in]: allowedAdminIds };

        } else {
            // 🟢 Fallback → only own contracts
            allowedAdminIds = [adminId];
            whereCondition.createdBy = adminId;
        }

        // -----------------------------
        // 3️⃣ Fetch contracts
        // -----------------------------
        const contracts = await Contracts.findAll({
            where: whereCondition,
            order: [["createdAt", "DESC"]],
        });

        return {
            status: true,
            message: "Contracts fetched successfully.",
            data: contracts,
        };
    } catch (error) {
        console.error("❌ Sequelize Error in getAllContracts:", error);

        return {
            status: false,
            message:
                error?.parent?.sqlMessage ||
                error?.message ||
                "Failed to fetch contracts.",
            data: [],
        };
    }
};

/**
 * Get Contract Id
 */
exports.getContractById = async (contractId, adminId, superAdminId) => {
    try {
        // -----------------------------
        // 1️⃣ Validate adminId
        // -----------------------------
        if (!adminId || isNaN(Number(adminId))) {
            return {
                status: false,
                message: "No valid admin ID found for this request.",
                data: [],
            };
        }

        // -----------------------------
        // 2️⃣ Build WHERE condition
        // -----------------------------
        const whereCondition = {};
        let allowedAdminIds = [];

        if (superAdminId && superAdminId === adminId) {
            // 🟢 Super Admin → fetch all admins under them + self
            const managedAdmins = await Admin.findAll({
                where: { superAdminId },
                attributes: ["id"],
            });

            const adminIds = managedAdmins.map((a) => a.id);
            adminIds.push(superAdminId);

            allowedAdminIds = adminIds;
            whereCondition.createdBy = { [Op.in]: adminIds };

        } else if (superAdminId && adminId) {
            // 🟢 Admin → own + super admin contracts
            allowedAdminIds = [adminId, superAdminId];
            whereCondition.createdBy = { [Op.in]: allowedAdminIds };

        } else {
            // 🟢 Fallback → only own contracts
            allowedAdminIds = [adminId];
            whereCondition.createdBy = adminId;
        }

        // -----------------------------
        // 3️⃣ Fetch contracts
        // -----------------------------
        const contracts = await Contracts.findOne({
            where: {
                id: contractId,
                ...whereCondition,
            },

            order: [["createdAt", "DESC"]],
        });
        if (!contracts) {
            return { status: false, message: "Contract not found." };
        }

        return {
            status: true,
            message: "Contracts fetched successfully.",
            data: contracts,
        };
    } catch (error) {
        console.error("❌ Sequelize Error in getContractById:", error);

        return {
            status: false,
            message:
                error?.parent?.sqlMessage ||
                error?.message ||
                "Failed to fetch contracts.",
            data: [],
        };
    }
};

/**
 * Update Contract By Id (Single Record)
 */
exports.updateContract = async (id, data) => {
    try {
        const contract = await Contracts.findByPk(id);

        if (!contract) {
            return {
                status: false,
                message: "Contract not found.",
            };
        }

        await contract.update({
            title: data.title,
            description: data.description,
            contractType: data.contractType,
            pdfFile: data.pdfFile,
            tags: data.tags,
        });

        return {
            status: true,
            message: "Contract updated successfully.",
            data: contract, // updated row
        };

    } catch (error) {
        console.error("❌ Sequelize Error in updateContract:", error);

        return {
            status: false,
            message:
                error?.parent?.sqlMessage ||
                error?.message ||
                "Failed to update contract.",
        };
    }
};

/**
 * Delete Contract By Id (Soft Delete)
 */
exports.deleteContractById = async (id, adminId) => {
    try {
        const contract = await Contracts.findByPk(id);

        if (!contract) {
            return {
                status: false,
                message: "Contract not found.",
            };
        }

        // Track who deleted it
        await contract.update({
            deletedBy: adminId,
        });

        // Soft delete
        await contract.destroy();

        return {
            status: true,
            message: "Contract deleted successfully.",
        };

    } catch (error) {
        console.error("❌ Sequelize Error in deleteContractById:", error);

        return {
            status: false,
            message:
                error?.parent?.sqlMessage ||
                error?.message ||
                "Failed to delete contract.",
        };
    }
};

exports.downloadContractPdf = async (contractId, adminId, superAdminId) => {
    try {
        // Reuse existing service
        const result = await exports.getContractById(
            contractId,
            adminId,
            superAdminId
        );

        if (!result.status) {
            return result;
        }

        const contract = result.data;

        if (!contract.pdfFile) {
            return {
                status: false,
                message: "PDF file not found for this contract.",
            };
        }

        const filePath = path.resolve(contract.pdfFile);

        if (!fs.existsSync(filePath)) {
            return {
                status: false,
                message: "PDF file does not exist on server.",
            };
        }

        return {
            status: true,
            message: "PDF ready for download.",
            filePath,
            fileName: `contract_${contract.id}.pdf`,
        };

    } catch (error) {
        console.error("❌ Error in downloadContractPdf:", error);

        return {
            status: false,
            message: error.message || "Failed to download contract PDF.",
        };
    }
};
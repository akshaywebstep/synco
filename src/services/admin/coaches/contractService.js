const { Contracts,Admin} = require("../../../models");
const { Op } = require("sequelize");

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

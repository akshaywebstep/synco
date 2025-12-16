const { Contracts } = require("../../../models");

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
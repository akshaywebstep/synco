    const { oneToOneLeads } = require("../../../models");
    const { Op } = require("sequelize");

    // ✅ Create
    exports.createOnetoOneLeads = async (data) => {
    try {
        const oneToOne = await oneToOneLeads.create(data);
        return { status: true, data: oneToOne.get({ plain: true }) };
    } catch (error) {
        console.error("❌ Error creating oneToOne lead:", error);
        return { status: false, message: error.message };
    }
    };
const { State } = require("../../models");
const { Op } = require("sequelize");

// Get all states
exports.getAllStates = async () => {
  try {
    const states = await State.findAll({
      order: [["name", "DESC"]],
    });

    return {
      status: true,
      message: `Fetched ${states.length} state(s) successfully.`,
      data: states,
    };
  } catch (error) {
    console.error("❌ Sequelize Error in getAllStates:", error);

    return {
      status: false,
      message: error?.parent?.sqlMessage || error?.message || "Failed to fetch states.",
    };
  }
};

// Get all states by country ID
exports.getStatesByCountryId = async (countryId) => {
  try {
    const states = await State.findAll({
      where: {
        countryId: {
          [Op.eq]: countryId
        }
      },
      order: [["name", "ASC"]]
    });

    return {
      status: true,
      message: `Fetched ${states.length} state(s) for country ID ${countryId} successfully.`,
      data: states
    };
  } catch (error) {
    console.error("❌ Sequelize Error in getStatesByCountryId:", error);

    return {
      status: false,
      message: error?.parent?.sqlMessage || error?.message || "Failed to fetch states for the country."
    };
  }
};
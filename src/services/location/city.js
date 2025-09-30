const { City } = require("../../models");
const { Op } = require("sequelize");

// Get all cities
exports.getAllCities = async () => {
  try {
    const cities = await City.findAll({
      order: [["name", "DESC"]],
    });

    return {
      status: true,
      message: `Fetched ${cities.length} city(s) successfully.`,
      data: cities,
    };
  } catch (error) {
    console.error("❌ Sequelize Error in getAllCities:", error);

    return {
      status: false,
      message: error?.parent?.sqlMessage || error?.message || "Failed to fetch cities.",
    };
  }
};

// Get all cities by state ID
exports.getCitiesByStateId = async (stateId) => {
  try {
    const cities = await City.findAll({
      where: {
        stateId: {
          [Op.eq]: stateId
        }
      },
      order: [["name", "ASC"]]
    });

    return {
      status: true,
      message: `Fetched ${cities.length} cit${cities.length === 1 ? 'y' : 'ies'} for state ID ${stateId} successfully.`,
      data: cities
    };
  } catch (error) {
    console.error("❌ Sequelize Error in getCitiesByStateId:", error);

    return {
      status: false,
      message: error?.parent?.sqlMessage || error?.message || "Failed to fetch cities for the state."
    };
  }
};
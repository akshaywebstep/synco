const { Country } = require("../../models");
const { Op } = require("sequelize");

// Get all countries
exports.getAllCountries = async () => {
  try {
    const countries = await Country.findAll({
      order: [["name", "ASC"]],
    });

    return {
      status: true,
      message: `Fetched ${countries.length} country(s) successfully.`,
      data: countries,
    };
  } catch (error) {
    console.error("❌ Sequelize Error in getAllCountries:", error);

    return {
      status: false,
      message:
        error?.parent?.sqlMessage ||
        error?.message ||
        "Failed to fetch countries.",
    };
  }
};

// Get all states by country ID
exports.getStatesByCountryId = async (countryId) => {
  try {
    const states = await State.findAll({
      where: {
        countryId: {
          [Op.eq]: countryId,
        },
      },
      order: [["name", "ASC"]],
    });

    return {
      status: true,
      message: `Fetched ${states.length} state(s) for country ID ${countryId} successfully.`,
      data: states,
    };
  } catch (error) {
    console.error("❌ Sequelize Error in getStatesByCountryId:", error);

    return {
      status: false,
      message:
        error?.parent?.sqlMessage ||
        error?.message ||
        "Failed to fetch states for the country.",
    };
  }
};

// Get a single country by ID
exports.getCountryById = async (countryId) => {
  try {
    const country = await Country.findByPk(countryId);

    if (!country) {
      return {
        status: false,
        message: `No country found with ID ${countryId}.`,
      };
    }

    return {
      status: true,
      message: `Country ID ${countryId} fetched successfully.`,
      data: country,
    };
  } catch (error) {
    console.error("❌ Sequelize Error in getCountryById:", error);

    return {
      status: false,
      message:
        error?.parent?.sqlMessage ||
        error?.message ||
        "Failed to fetch country by ID.",
    };
  }
};

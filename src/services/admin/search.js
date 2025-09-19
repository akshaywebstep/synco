// services/admin/search.js
const { Op } = require("sequelize");
const { BookingStudentMeta, Booking } = require("../../models");

const DEBUG = process.env.DEBUG === "true";

/**
 * Performs global search across students.
 * @param {number} adminId - ID of the admin performing the search
 * @param {string} query - Search string
 */
exports.getGlobalSearch = async (adminId, query) => {
  try {
    if (DEBUG) {
      console.log("🟢 getGlobalSearch called with:", { adminId, query });
    }

    if (!query || query.trim().length < 2) {
      if (DEBUG) console.log("⚠️ Query too short or missing:", query);
      return {
        status: true,
        message: "No query or query too short.",
        data: [],
      };
    }

    const likeQuery = { [Op.like]: `%${query}%` };

    if (DEBUG) console.log("🔍 likeQuery:", likeQuery);

    const students = await BookingStudentMeta.findAll({
      where: {
        [Op.or]: [
          { studentFirstName: likeQuery },
          { studentLastName: likeQuery },
        ],
      },
      include: [
        {
          model: Booking,
          as: "booking",
          required: true,
          attributes: [],
        },
      ],
      limit: 20,
    });

    if (DEBUG) console.log("✅ Students fetched:", students.length);

    const results = students.map((s) => ({
      id: s.id,
      firstName: s.studentFirstName,
      lastName: s.studentLastName,
    }));

    return {
      status: true,
      message: "Search results fetched successfully.",
      data: results,
    };
  } catch (error) {
    console.error("❌ Error in getGlobalSearch:", error);
    return {
      status: false,
      message: error?.message || "Failed to fetch search results.",
      data: [],
    };
  }
};

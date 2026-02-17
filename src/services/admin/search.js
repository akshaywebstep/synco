// services/admin/search.js
const { Op } = require("sequelize");
const { BookingStudentMeta, Booking,Admin } = require("../../models");

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

    // STEP 1: Validate query
    if (!query || query.trim().length < 2) {
      if (DEBUG) console.log("⚠️ Query too short or missing:", query);
      return {
        status: true,
        message: "No query or query too short.",
        data: [],
      };
    }

    const likeQuery = { [Op.like]: `%${query.trim()}%` };
    if (DEBUG) console.log("🔍 likeQuery:", likeQuery);

    // STEP 2: Fetch students
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
          attributes: [], // no extra fields from Booking for now
        },
      ],
      attributes: ["id", "studentFirstName", "studentLastName"],
      limit: 20,
    });

    if (DEBUG) console.log("✅ Students fetched:", students.length);

    // STEP 3: Format results
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
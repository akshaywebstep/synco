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

// Get All
exports.getAllOnetoOneLeads = async (adminId) => {
  try {
    const oneToOne = await oneToOneLeads.findAll({
      where: { createdBy: adminId },
      order: [["createdAt", "DESC"]],
    });
    return { status: true, data: oneToOne };
  } catch (error) {
    console.error("❌ Error fetching oneToOne leads:", error);
    return { status: false, message: error.message };
  }
};

exports.getOnetoOneLeadsById = async (id, adminId) => {
  try {
    const oneToOne = await oneToOneLeads.findOne({
      where: { id, createdBy: adminId },
    });

    if (!oneToOne) {
      return { status: false, message: "One-to-one lead not found or unauthorized." };
    }

    return { status: true, data: oneToOne };
  } catch (error) {
    console.error("❌ Error fetching one-to-one lead by ID:", error);
    return { status: false, message: error.message };
  }
};

//      paid  from and todate  ->createdAt
//  trail  from and todate  ->createdAt
//  cancel from and todate  ->createdAt
//  student filter
//  total leads -> count  with conversion of monthly
//  new leads  -> count   with conversion of monthly
//  leads to bookings  -> count   with conversion of monthly
//  source of booking   ->count
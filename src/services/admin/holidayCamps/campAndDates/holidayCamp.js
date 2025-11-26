
const { HolidayCamp } = require("../../../../models");

// ✅ CREATE
exports.createHolidayCamp = async ({ name, createdBy }) => {
  try {
    const camp = await HolidayCamp.create({ name, createdBy });
    return { status: true, data: camp, message: "holiday camp created." };
  } catch (error) {
    return { status: false, message: "Create camp failed. " + error.message };
  }
};

// ✅ GET ALL - by admin
exports.getAllHolidayCamp= async (adminId) => {
  try {
    if (!adminId || isNaN(Number(adminId))) {
      return {
        status: false,
        message: "No valid parent or super admin found for this request.",
        data: [],
      };
    }
    
    const camp = await HolidayCamp.findAll({
      where: { createdBy: Number(adminId) },
      order: [["createdAt", "DESC"]],
    });
    return { status: true, data: camp };
  } catch (error) {
    return { status: false, message: "Fetch camp failed. " + error.message };
  }
};

// ✅ GET BY ID - with admin ownership check
exports.getHolidayCampById = async (id, adminId) => {
  try {

    if (!adminId || isNaN(Number(adminId))) {
      return {
        status: false,
        message: "No valid parent or super admin found for this request.",
        data: [],
      };
    }

    const camp = await HolidayCamp.findOne({
      where: { id, createdBy: Number(adminId) },
    });
    if (!camp) {
      return { status: false, message: "Camp not found or unauthorized." };
    }
    return { status: true, data: camp };
  } catch (error) {
    return { status: false, message: "Get camp failed. " + error.message };
  }
};

// ✅ UPDATE with createdBy check
exports.updateHolidayCamp = async (id, { name }, adminId) => {
  try {
    const camp = await HolidayCamp.findOne({
      where: { id, createdBy: adminId }, // ✅ ownership check
    });

    if (!camp) {
      console.warn(`⚠️ camp not found. ID: ${id}, Admin ID: ${adminId}`);
      return { status: false, message: "camp not found or unauthorized." };
    }

    await camp.update({ name });
    return { status: true, data: camp, message: "camp updated." };
  } catch (error) {
    return { status: false, message: "Update camp failed. " + error.message };
  }
};

exports.deleteHolidayCamp = async (id, deletedBy) => {
  try {
    // ✅ Find the HolidayCamp by ID and createdBy
    const camp = await HolidayCamp.findOne({
      where: { id, createdBy: deletedBy },
    });

    if (!camp) {
      return { status: false, message: "camp not found or unauthorized." };
    }

    // ✅ Track who deleted the camp
    await camp.update({ deletedBy });

    // ✅ Soft delete (sets deletedAt)
    await camp.destroy();

    return { status: true, message: "holiday camp deleted successfully" };
  } catch (error) {
    console.error("❌ deleteCamp Service Error:", error);
    return {
      status: false,
      message: "Delete camp failed. " + error.message,
    };
  }
};

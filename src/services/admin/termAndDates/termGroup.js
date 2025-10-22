const { TermGroup, Term } = require("../../../models"); // ✅ Correct model

// ✅ CREATE
exports.createGroup = async ({ name, createdBy }) => {
  try {
    const group = await TermGroup.create({ name, createdBy });
    return { status: true, data: group, message: "Term group created." };
  } catch (error) {
    return { status: false, message: "Create group failed. " + error.message };
  }
};

// ✅ GET ALL - by admin
exports.getAllGroups = async (adminId) => {
  try {
    if (!adminId || isNaN(Number(adminId))) {
      return {
        status: false,
        message: "No valid parent or super admin found for this request.",
        data: [],
      };
    }
    
    const groups = await TermGroup.findAll({
      where: { createdBy: Number(adminId) },
      order: [["createdAt", "DESC"]],
    });
    return { status: true, data: groups };
  } catch (error) {
    return { status: false, message: "Fetch groups failed. " + error.message };
  }
};

// ✅ GET BY ID - with admin ownership check
exports.getGroupById = async (id, adminId) => {
  try {

    if (!adminId || isNaN(Number(adminId))) {
      return {
        status: false,
        message: "No valid parent or super admin found for this request.",
        data: [],
      };
    }

    const group = await TermGroup.findOne({
      where: { id, createdBy: Number(adminId) },
    });
    if (!group) {
      return { status: false, message: "Group not found or unauthorized." };
    }
    return { status: true, data: group };
  } catch (error) {
    return { status: false, message: "Get group failed. " + error.message };
  }
};

// ✅ UPDATE with createdBy check
exports.updateGroup = async (id, { name }, adminId) => {
  try {
    const group = await TermGroup.findOne({
      where: { id, createdBy: adminId }, // ✅ ownership check
    });

    if (!group) {
      console.warn(`⚠️ Group not found. ID: ${id}, Admin ID: ${adminId}`);
      return { status: false, message: "Group not found or unauthorized." };
    }

    await group.update({ name });
    return { status: true, data: group, message: "Group updated." };
  } catch (error) {
    return { status: false, message: "Update group failed. " + error.message };
  }
};

exports.deleteGroup = async (id, deletedBy) => {
  try {
    // ✅ Find the TermGroup by ID and createdBy
    const group = await TermGroup.findOne({
      where: { id, createdBy: deletedBy },
    });

    if (!group) {
      return { status: false, message: "Group not found or unauthorized." };
    }

    // // ✅ Unlink associated terms
    // await Term.update(
    //   { termGroupId: null },
    //   { where: { termGroupId: id } }
    // );

    // ✅ Track who deleted the group
    await group.update({ deletedBy });

    // ✅ Soft delete (sets deletedAt)
    await group.destroy();

    return { status: true, message: "Term group deleted successfully" };
  } catch (error) {
    console.error("❌ deleteGroup Service Error:", error);
    return {
      status: false,
      message: "Delete group failed. " + error.message,
    };
  }
};

const {
  CustomTemplate, TemplateCategory
} = require("../../../models");
const { Op } = require("sequelize");

// ✅ Create a new class
exports.createTemplateCategory = async (data) => {
  try {
    const savedCategory = await TemplateCategory.create(data);
    return { status: true, data: TemplateCategory };
  } catch (error) {
    console.error("❌ createTemplateCategory Error:", error);
    return { status: false, message: error.message };
  }
};
exports.listTemplateCategories = async (createdBy) => {
  if (!createdBy || isNaN(Number(createdBy))) {
    return {
      status: false,
      message: "No valid parent or super admin found for this request.",
      data: [],
    };
  }

  try {
    const categories = await TemplateCategory.findAll({
      where: { createdBy: Number(createdBy) }, // ✅ Filter only his created data
      order: [["id", "DESC"]],
    });

    return { status: true, data: categories };
  } catch (error) {
    console.error("❌ listTemplateCategories Error:", error);
    return { status: false, message: error.message, data: [] };
  }
};

// ✅ Soft delete category
// exports.deleteTemplateCategory = async (id, adminId) => {
//   try {
//     const category = await TemplateCategory.findOne({ where: { id } });

//     if (!category) {
//       return { status: false, message: "Category not found" };
//     }

//     await category.update({ deletedBy: adminId }); // store who deleted
//     await category.destroy(); // soft delete (paranoid enabled)

//     return { status: true, message: "Category deleted successfully" };
//   } catch (error) {
//     console.error("❌ deleteTemplateCategory Error:", error);
//     return { status: false, message: error.message };
//   }
// };
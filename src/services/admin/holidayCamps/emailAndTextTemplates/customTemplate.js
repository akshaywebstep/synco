const {
  CustomTemplate,TemplateCategory
} = require("../../../../models");
TemplateCategoryService = require("./templateCategory");
const { Op } = require("sequelize");

// ✅ Create a new class
exports.createCustomTemplate = async (data) => {
    try {
        const savedcustomTemplate = await CustomTemplate.create(data);
        return { status: true, data: savedcustomTemplate };
    } catch (error) {
        console.error("❌ createCustomTemplate Error:", error);
        return { status: false, message: error.message };
    }
};
// ✅ LIST custom templates (filter by category if provided, dynamic admin scoping)
exports.listCustomTemplates = async (createdBy, templateCategoryId = null) => {
  try {
    const where = { createdBy: Number(createdBy) };

    if (templateCategoryId) {
      where.template_category_id = Number(templateCategoryId);
    }

    // Fetch templates
    const templates = await CustomTemplate.findAll({
      where,
      order: [["id", "DESC"]],
      raw: true,
    });

    // Fetch category names created by this admin
    const catResult =await TemplateCategoryService.listTemplateCategories(createdBy);
    const catMap = {};

    catResult.data.forEach((cat) => {
      catMap[cat.id] = cat.category; // Map {2: "Cancellations"}
    });

    // Final grouping
    const grouped = {
      email: [],
      text: [],
    };

    const bucket = {
      email: {},
      text: {},
    };

    templates.forEach((temp) => {
      const mode = temp.mode_of_communication; // email/text
      const catName = catMap[temp.template_category_id] || "Uncategorized";

      if (!bucket[mode][catName]) {
        bucket[mode][catName] = [];
      }

      bucket[mode][catName].push(temp);
    });

    // Convert objects into arrays
    for (const mode of ["email", "text"]) {
      Object.keys(bucket[mode]).forEach((cat) => {
        grouped[mode].push({
          template_category: cat,
          templates: bucket[mode][cat],
        });
      });
    }

    return { status: true, data: grouped };
  } catch (error) {
    console.error("❌ listCustomTemplates Error:", error);
    return { status: false, message: error.message, data: [] };
  }
};

// ✅ DELETE custom template (soft delete + track deletedBy)
exports.deleteCustomTemplate = async (id, adminId) => {
  try {
    const template = await CustomTemplate.findOne({ where: { id } });

    if (!template) {
      return { status: false, message: "Template not found." };
    }

    await template.update({ deletedBy: adminId });
    await template.destroy(); // paranoid true → soft delete

    return { status: true, message: "Custom template deleted successfully." };
  } catch (error) {
    console.error("❌ deleteCustomTemplate Error:", error);
    return { status: false, message: error.message };
  }
};
// ✅ UPDATE custom template
exports.updateCustomTemplate = async (id, data, adminId) => {
  try {
    const template = await CustomTemplate.findOne({ where: { id, createdBy: Number(adminId) } });

    if (!template) {
      return { status: false, message: "Template not found or you don't have permission to update this template." };
    }

    const updated = await template.update(data);
    return { status: true, data: updated };
  } catch (error) {
    console.error("❌ updateCustomTemplate Error:", error);
    return { status: false, message: error.message };
  }
};
// ✅ FETCH custom template by ID (admin scoped)
exports.getCustomTemplateById = async (id, adminId) => {
  try {
    const template = await CustomTemplate.findOne({
      where: { id: Number(id), createdBy: Number(adminId) },
      raw: true,
    });

    if (!template) {
      return { status: false, message: "Template not found or you don't have access." };
    }

    return { status: true, data: template };
  } catch (error) {
    console.error("❌ getCustomTemplateById Error:", error);
    return { status: false, message: error.message };
  }
};

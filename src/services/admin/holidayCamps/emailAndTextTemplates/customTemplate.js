const {
  CustomTemplate, TemplateCategory
} = require("../../../../models");
TemplateCategoryService = require("./templateCategory");
const { Op } = require("sequelize");

// ✅ Create a new class
// Service: createCustomTemplate
exports.createCustomTemplate = async (data) => {
  try {
    // Always ensure categories are arrays
    if (!Array.isArray(data.template_category_id)) {
      data.template_category_id = [data.template_category_id];
    }

    const savedTemplate = await CustomTemplate.create(data);

    return {
      status: true,
      data: savedTemplate
    };

  } catch (error) {
    console.error("❌ Service createCustomTemplate Error:", error);
    return {
      status: false,
      message: error.message
    };
  }
};

// ✅ LIST custom templates (filter by category if provided, dynamic admin scoping)
exports.listCustomTemplates = async (createdBy, templateCategoryId = null) => {
  try {
    const where = { createdBy: Number(createdBy) };

    if (templateCategoryId) {
      const filterId = Number(templateCategoryId);
      // (2) array search condition for JSON column
      where.template_category_id = {
        [Op.or]: [
          { [Op.contains]: [filterId] },   // PostgreSQL / Sequelize JSON contains
          sequelize.where(
            sequelize.fn("JSON_CONTAINS", sequelize.col("template_category_id"), JSON.stringify(filterId)),
            1
          )
        ]
      };
    }

    const templates = await CustomTemplate.findAll({
      where,
      order: [["id", "DESC"]],
      raw: true,
    });

    const catResult = await TemplateCategoryService.listTemplateCategories(createdBy);
    const catMap = {};

    catResult.data.forEach((cat) => {
      catMap[cat.id] = cat.category;
    });

    // ✅ Final grouping format must stay same:
    const grouped = {
      email: [],
      text: [],
    };

    const bucket = {
      email: {},
      text: {},
    };

    templates.forEach((temp) => {
      const mode = temp.mode_of_communication;

      // (3) read array of IDs
      let catIds = temp.template_category_id;

      console.log('catIdtesmp', catIds);

      catIds = catIds ? JSON.parse(catIds) : [];

      const catNames = catIds.map(id => catMap[id] || "Uncategorized");

      // (5) push template under each category name
      catNames.forEach(catName => {
        if (!bucket[mode][catName]) {
          bucket[mode][catName] = [];
        }
        bucket[mode][catName].push(temp);
      });
    });

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
    await template.destroy();

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

    // (6) ensure update also stores array
    if (!Array.isArray(data.template_category_id)) {
      data.template_category_id = [data.template_category_id];
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
const {
  CustomTemplate, TemplateCategory
} = require("../../../models");
TemplateCategoryService = require("./templateCategory");
const { Op } = require("sequelize");

// Service: createCustomTemplate
exports.createCustomTemplate = async (data) => {
  try {
    // Ensure string format before saving
    if (Array.isArray(data.template_category_id)) {
      data.template_category_id = JSON.stringify(data.template_category_id);
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

    // Filter by template category if provided
    if (templateCategoryId) {
      const filterId = Number(templateCategoryId);
      where.template_category_id = {
        [Op.or]: [
          { [Op.contains]: [filterId] },
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

    // Fetch categories
    const catResult = await TemplateCategoryService.listTemplateCategories(createdBy);
    const catMap = {};
    catResult.data.forEach(cat => {
      catMap[cat.id] = cat.category;
    });

    // Grouping buckets
    const grouped = { email: [], text: [] };
    const bucket = { email: {}, text: {} };

    templates.forEach(temp => {
      // -------------------------
      // 1) Clean tags
      // -------------------------
      if (typeof temp.tags === "string") {
        temp.tags = temp.tags.replace(/\\|"/g, "").trim();
      }

      // -------------------------
      // 2) Parse content JSON
      // -------------------------
      if (typeof temp.content === "string") {
        try {
          temp.content = JSON.parse(temp.content);
        } catch {
          temp.content = { blocks: [] };
        }
      }

      // -------------------------
      // 3) Parse template_category_id safely
      // -------------------------
      let catIds = [];
      try {
        const parsed = JSON.parse(temp.template_category_id);
        parsed.forEach(item => {
          if (typeof item === "string") {
            // Remove extra brackets and split
            const cleaned = item.replace(/[\[\]]/g, "");
            cleaned.split(",").forEach(id => {
              const n = Number(id);
              if (!isNaN(n)) catIds.push(n);
            });
          } else if (typeof item === "number") {
            catIds.push(item);
          }
        });
      } catch {
        catIds = [];
      }

      // -------------------------
      // 4) Map category IDs to names
      // -------------------------
      const catNames = catIds.length
        ? catIds.map(id => catMap[id] || "Uncategorized")
        : ["Uncategorized"];

      // -------------------------
      // 5) Group templates by mode and category
      // -------------------------
      const mode = temp.mode_of_communication;
      catNames.forEach(catName => {
        if (!bucket[mode][catName]) bucket[mode][catName] = [];
        bucket[mode][catName].push(temp);
      });
    });

    // -------------------------
    // 6) Convert bucket to grouped array
    // -------------------------
    for (const mode of ["email", "text"]) {
      Object.keys(bucket[mode]).forEach(cat => {
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
// ✅ UPDATE custom template
exports.updateCustomTemplate = async (id, data, adminId) => {
  try {
    // Fetch template only if created by this admin
    const template = await CustomTemplate.findOne({
      where: { id, createdBy: Number(adminId) }
    });

    if (!template) {
      return {
        status: false,
        message: "Template not found or you don't have permission to update this template."
      };
    }

    // Update directly (data must already be validated/stringified in controller)
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
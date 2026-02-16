const {
  CustomTemplate, TemplateCategory,
  Admin
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
exports.listCustomTemplates = async (adminId, superAdminId, createdBy, templateCategoryId = null) => {
  try {

    // -------------------------
    // 1) No admin / createdBy filtering
    // -------------------------
    const where = {}; // <-- FILTER REMOVED

    // (Optional) Agar templateCategoryId ka filter rakhna hai to ye rehne do
    if (templateCategoryId !== undefined && templateCategoryId !== null) {
      const filterId = Number(templateCategoryId);
      if (!isNaN(filterId)) {
        where.template_category_id = sequelize.where(
          sequelize.fn("JSON_CONTAINS", sequelize.col("template_category_id"), JSON.stringify(filterId)),
          1
        );
      }
    }

    // -------------------------
    // 2) Fetch templates (same as before)
    // -------------------------
    const templates = await CustomTemplate.findAll({
      where,
      order: [["id", "DESC"]],
      raw: true,
    });

    // -------------------------
    // 3) Fetch categories (same as before)
    // -------------------------
    const catResult = await TemplateCategoryService.listTemplateCategories(createdBy);
    const catMap = {};
    catResult.data.forEach(cat => {
      catMap[cat.id] = cat.category;
    });

    // -------------------------
    // 4) Group templates by mode & category (UNCHANGED)
    // -------------------------
    const grouped = { email: [], text: [] };
    const bucket = { email: {}, text: {} };

    templates.forEach(temp => {
      if (typeof temp.tags === "string") temp.tags = temp.tags.replace(/\\|"/g, "").trim();

      if (typeof temp.content === "string") {
        try { temp.content = JSON.parse(temp.content); } 
        catch { temp.content = { blocks: [] }; }
      }

      let catIds = [];
      try {
        const parsed = JSON.parse(temp.template_category_id);
        parsed.forEach(item => {
          if (typeof item === "string") {
            const cleaned = item.replace(/[\[\]]/g, "");
            cleaned.split(",").forEach(id => {
              const n = Number(id);
              if (!isNaN(n)) catIds.push(n);
            });
          } else if (typeof item === "number") {
            catIds.push(item);
          }
        });
      } catch { catIds = []; }

      const catNames = catIds.length
        ? catIds.map(id => catMap[id] || "Uncategorized")
        : ["Uncategorized"];

      const mode = ["email", "text"].includes(temp.mode_of_communication) ? temp.mode_of_communication : "email";

      catNames.forEach(catName => {
        if (!bucket[mode][catName]) bucket[mode][catName] = [];
        bucket[mode][catName].push(temp);
      });
    });

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

// exports.listCustomTemplates = async (adminId, superAdminId, createdBy, templateCategoryId = null) => {
//   try {
//     const createdByNum = Number(createdBy);
//     if (isNaN(createdByNum)) {
//       return { status: false, message: "Invalid createdBy ID", data: [] };
//     }

//     // -------------------------
//     // 1) Determine allowed admin IDs
//     // -------------------------
//     let allowedAdminIds = [];
//     if (superAdminId && superAdminId === adminId) {
//       // Super Admin → fetch all admins under them + self
//       const managedAdmins = await Admin.findAll({
//         where: { superAdminId },
//         attributes: ["id"],
//       });
//       allowedAdminIds = managedAdmins.map(a => a.id);
//       allowedAdminIds.push(superAdminId);
//     } else if (superAdminId && adminId) {
//       // Admin → fetch own + super admin
//       allowedAdminIds = [adminId, superAdminId];
//     } else {
//       // Fallback → just self
//       allowedAdminIds = [adminId];
//     }

//     // -------------------------
//     // 2) Build WHERE condition
//     // -------------------------
//     const where = { createdBy: { [Op.in]: allowedAdminIds } };

//     if (templateCategoryId !== undefined && templateCategoryId !== null) {
//       const filterId = Number(templateCategoryId);
//       if (!isNaN(filterId)) {
//         where.template_category_id = sequelize.where(
//           sequelize.fn("JSON_CONTAINS", sequelize.col("template_category_id"), JSON.stringify(filterId)),
//           1
//         );
//       }
//     }

//     // -------------------------
//     // 3) Fetch templates
//     // -------------------------
//     const templates = await CustomTemplate.findAll({
//       where,
//       order: [["id", "DESC"]],
//       raw: true,
//     });

//     // -------------------------
//     // 4) Fetch categories
//     // -------------------------
//     const catResult = await TemplateCategoryService.listTemplateCategories(createdBy);
//     const catMap = {};
//     catResult.data.forEach(cat => {
//       catMap[cat.id] = cat.category;
//     });

//     // -------------------------
//     // 5) Group templates by mode & category
//     // -------------------------
//     const grouped = { email: [], text: [] };
//     const bucket = { email: {}, text: {} };

//     templates.forEach(temp => {
//       if (typeof temp.tags === "string") temp.tags = temp.tags.replace(/\\|"/g, "").trim();

//       if (typeof temp.content === "string") {
//         try { temp.content = JSON.parse(temp.content); } 
//         catch { temp.content = { blocks: [] }; }
//       }

//       let catIds = [];
//       try {
//         const parsed = JSON.parse(temp.template_category_id);
//         parsed.forEach(item => {
//           if (typeof item === "string") {
//             const cleaned = item.replace(/[\[\]]/g, "");
//             cleaned.split(",").forEach(id => {
//               const n = Number(id);
//               if (!isNaN(n)) catIds.push(n);
//             });
//           } else if (typeof item === "number") {
//             catIds.push(item);
//           }
//         });
//       } catch { catIds = []; }

//       const catNames = catIds.length
//         ? catIds.map(id => catMap[id] || "Uncategorized")
//         : ["Uncategorized"];

//       const mode = ["email", "text"].includes(temp.mode_of_communication) ? temp.mode_of_communication : "email";
//       catNames.forEach(catName => {
//         if (!bucket[mode][catName]) bucket[mode][catName] = [];
//         bucket[mode][catName].push(temp);
//       });
//     });

//     for (const mode of ["email", "text"]) {
//       Object.keys(bucket[mode]).forEach(cat => {
//         grouped[mode].push({
//           template_category: cat,
//           templates: bucket[mode][cat],
//         });
//       });
//     }

//     return { status: true, data: grouped };
//   } catch (error) {
//     console.error("❌ listCustomTemplates Error:", error);
//     return { status: false, message: error.message, data: [] };
//   }
// };

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

exports.getCustomTemplateById = async (id) => {
  try {
    const templateId = Number(id);
    // const adminIdNum = Number(adminId);

    // if (isNaN(templateId) || isNaN(adminIdNum)) {
    //   return { status: false, message: "Invalid ID provided." };
    // }

    // -------------------------
    // 1) Determine allowed admin IDs
    // -------------------------
    // let allowedAdminIds = [];

    // if (superAdminId && superAdminId === adminIdNum) {
    //   // 🟢 Super Admin → fetch all admins under them + self
    //   const managedAdmins = await Admin.findAll({
    //     where: { superAdminId },
    //     attributes: ["id"],
    //   });

    //   allowedAdminIds = managedAdmins.map(a => a.id);
    //   allowedAdminIds.push(superAdminId);

    // } else if (superAdminId && adminIdNum) {
    //   // 🟢 Admin → own + super admin
    //   allowedAdminIds = [adminIdNum, superAdminId];

    // } else {
    //   // 🟢 Fallback → only self
    //   allowedAdminIds = [adminIdNum];
    // }

    // -------------------------
    // 2) Fetch template
    // -------------------------
    const template = await CustomTemplate.findOne({
      where: {
        id: templateId,
        // createdBy: { [Op.in]: allowedAdminIds },
      },
      raw: true,
    });

    if (!template) {
      return {
        status: false,
        message: "Template not found or you don't have access.",
      };
    }

    return { status: true, data: template };

  } catch (error) {
    console.error("❌ getCustomTemplateById Error:", error);
    return { status: false, message: error.message };
  }
};
const { validateFormData } = require("../../../../utils/validateFormData");
const { logActivity } = require("../../../../utils/admin/activityLogger");
const { createNotification } = require("../../../../utils/admin/notificationHelper");
const { getMainSuperAdminOfAdmin } = require("../../../../utils/auth");
const ToDoService = require("../../../../services/admin/holidayCamps/toDoList/ToDoService");

const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "to-do";

// ✅ CREATE TASK
exports.createTask = async (req, res) => {
  const { title, description, attachments, assignedAdmins, status, priority } = req.body;

  const validation = validateFormData(req.body, {
    requiredFields: ["title", "description"],
  });

  if (!validation.isValid) {
    await logActivity(req, PANEL, MODULE, "create", { message: validation.error }, false);
    return res.status(400).json({ status: false, message: validation.error });
  }

  try {
    const result = await ToDoService.createTask({
      title,
      description,
      attachments: attachments || null,
      assignedAdmins: assignedAdmins || null,
      status,
      priority,
      createdBy: req.admin.id,
    });

    if (!result.status) {
      await logActivity(req, PANEL, MODULE, "create", { message: result.message }, false);
      return res.status(500).json({ status: false, message: result.message });
    }

    await logActivity(req, PANEL, MODULE, "create", { message: "Created successfully" }, true);

    const adminFullName = req.admin?.name || "Unknown Admin";
    await createNotification(req, "Task Created", `New task added by ${adminFullName}`, "Support");

    return res.status(201).json({ status: true, message: "Task created successfully", data: result.data });

  } catch (error) {
    console.error("❌ createTask controller Error:", error);
    await logActivity(req, PANEL, MODULE, "create", { message: error.message }, false);
    return res.status(500).json({ status: false, message: "Server error" });
  }
};

// ✅ LIST TASKS (By Super Admin)
exports.listTasks = async (req, res) => {
  const mainSuperAdminResult = await getMainSuperAdminOfAdmin(req.admin.id);
  const superAdminId = mainSuperAdminResult?.superAdmin?.id ?? null;

  const result = await ToDoService.listTasks(superAdminId);

  if (!result.status) {
    await logActivity(req, PANEL, MODULE, "list", { message: result.message }, false);
    return res.status(500).json({ status: false, message: result.message });
  }

  await logActivity(req, PANEL, MODULE, "list", { message: "Fetched successfully" }, true);
  return res.status(200).json({ status: true, data: result.data });
};

// ✅ GET ONE TASK
exports.getTaskById = async (req, res) => {
  const { id } = req.params;
  const result = await ToDoService.getTaskById(id);

  if (!result.status) {
    await logActivity(req, PANEL, MODULE, "view-one", { message: result.message }, false);
    return res.status(404).json({ status: false, message: result.message });
  }

  await logActivity(req, PANEL, MODULE, "view-one", { message: "Fetched successfully" }, true);
  return res.status(200).json({ status: true, data: result.data });
};

exports.updateTaskStatus = async (req, res) => {
  const { id, status } = req.body;

  if (!id || !status) {
    await logActivity(req, PANEL, MODULE, "update-status", { message: "id & status are required" }, false);
    return res.status(400).json({ status: false, message: "id & status are required" });
  }

  try {
    const result = await ToDoService.updateTaskStatus(id, status);

    if (!result.status) {
      await logActivity(req, PANEL, MODULE, "update-status", { message: result.message }, false);
      return res.status(500).json({ status: false, message: result.message });
    }

    await logActivity(req, PANEL, MODULE, "update-status", { message: "Status updated successfully" }, true);

    const adminFullName = req.admin?.name || "Unknown Admin";
    await createNotification(
      req,
      "Task Status Updated",
      `Task status updated to "${status}" by ${adminFullName}`,
      "Support"
    );

    return res.status(200).json({ status: true, message: "Status updated successfully" });

  } catch (error) {
    console.error("❌ updateTaskStatus Controller Error:", error);
    await logActivity(req, PANEL, MODULE, "update-status", { message: error.message }, false);
    return res.status(500).json({ status: false, message: error.message });
  }
};
exports.updateSortOrder = async (req, res) => {
  const { sortOrder } = req.body;

  if (!Array.isArray(sortOrder)) {
    await logActivity(req, PANEL, MODULE, "update-sort-order", { message: "sortOrder must be an array" }, false);
    return res.status(400).json({
      status: false,
      message: "sortOrder must be an array of task IDs",
    });
  }

  try {
    const result = await ToDoService.updateSortOrder(sortOrder);

    if (!result.status) {
      await logActivity(req, PANEL, MODULE, "update-sort-order", { message: result.message }, false);
      return res.status(500).json({ status: false, message: result.message });
    }

    await logActivity(req, PANEL, MODULE, "update-sort-order", { message: "Sort order updated successfully" }, true);

    const adminFullName = req.admin?.name || "Unknown Admin";
    await createNotification(
      req,
      "Task Sort Order Updated",
      `Task order updated by ${adminFullName}`,
      "Support"
    );

    return res.status(200).json({ status: true, message: "Sort order updated successfully" });

  } catch (error) {
    console.error("❌ updateSortOrder Controller Error:", error);
    await logActivity(req, PANEL, MODULE, "update-sort-order", { message: error.message }, false);
    return res.status(500).json({ status: false, message: error.message });
  }
};

// ✅ UPDATE TASK
// exports.updateTask = async (req, res) => {
//   const { id } = req.params;
//   const result = await ToDoService.updateTask(id, req.body);

//   if (!result.status) {
//     await logActivity(req, PANEL, MODULE, "update", { message: result.message }, false);
//     return res.status(500).json({ status: false, message: result.message });
//   }

//   await logActivity(req, PANEL, MODULE, "update", { message: "Updated successfully" }, true);
//   return res.status(200).json({ status: true, message: "Task updated successfully" });
// };

// ✅ DELETE TASK
exports.deleteTask = async (req, res) => {
  const { id } = req.params;
  const result = await ToDoService.deleteTask(id);

  if (!result.status) {
    await logActivity(req, PANEL, MODULE, "delete", { message: result.message }, false);
    return res.status(500).json({ status: false, message: result.message });
  }

  await logActivity(req, PANEL, MODULE, "delete", { message: "Deleted successfully" }, true);
  return res.status(200).json({ status: true, message: "Task deleted successfully" });
};

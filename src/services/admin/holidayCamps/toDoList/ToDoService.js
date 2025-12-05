const { ToDoList, Admin } = require("../../../../models")
// ✅ Create Task
exports.createTask = async (data) => {
    try {
        const task = await ToDoList.create(data);
        return { status: true, data: task };
    } catch (error) {
        console.error("❌ createTask Error:", error);
        return { status: false, message: error.message };
    }
};

// ✅ List Tasks by Super Admin
exports.listTasks = async (createdBy) => {
    if (!createdBy || isNaN(Number(createdBy))) {
        return {
            status: false,
            message: "Invalid super admin ID",
            data: {},
        };
    }

    try {
        // Fetch all tasks for the user
        const tasks = await ToDoList.findAll({
            where: { createdBy: Number(createdBy) },
            order: [
                ["sort_order", "ASC"],
                ["id", "DESC"]
            ],
            raw: true,
        });

        // Group tasks by status
        const grouped = {
            to_do: [],
            in_progress: [],
            in_review: [],
            completed: [],
        };

        // Collect all admin IDs (creator + assigned)
        const adminIdsSet = new Set();
        tasks.forEach(task => {
            if (task.created_by) adminIdsSet.add(task.created_by);

            let assigned = task.assignedAdmins || task.assigned_admins;

            if (typeof assigned === "string") {
                try { assigned = JSON.parse(assigned.replace(/'/g, '"')); }
                catch { assigned = []; }
            }

            if (!Array.isArray(assigned)) assigned = [];
            assigned.forEach(id => adminIdsSet.add(id));
        });

        const adminIds = Array.from(adminIdsSet);

        // Fetch all admins
        const admins = await Admin.findAll({
            where: { id: adminIds },
            attributes: ["id", "firstName", "lastName", "profile"], // make sure profile exists
            raw: true,
        });

        // Map admins by ID
        const adminMap = Object.fromEntries(
            admins.map(a => [
                String(a.id),
                { id: a.id, name: `${a.firstName} ${a.lastName}`.trim(), profile: a.profile || "/reportsIcons/Avatar.png" }
            ])
        );

        // Process tasks
        for (let task of tasks) {
            task.sortOrder = task.sort_order ?? 0;
            task.attachments = safeJson(task.attachments);

            // Transform assignedAdmins to full objects
            const assignedIds = safeJson(task.assignedAdmins || task.assigned_admins) || [];
            task.assignedAdmins = assignedIds.map(id => adminMap[id] || { id, name: "Unknown", profile: "/reportsIcons/Avatar.png" });

            // Optional: still keep createdByDetails
            task.createdByDetails = task.created_by ? (adminMap[String(task.created_by)] || {}) : {};

            const status = (task.status || "").toLowerCase();
            if (grouped[status]) grouped[status].push(task);
            else grouped.to_do.push(task);
        }

        return { status: true, data: grouped };

    } catch (error) {
        console.error("❌ listTasks Error:", error);
        return { status: false, message: error.message, data: {} };
    }
};

// ----------------------------------------------------
// Helper To Safely Parse JSON
// ----------------------------------------------------
function safeJson(value) {
    if (!value) return [];

    // Already an array
    if (Array.isArray(value)) return value;

    // Case: MySQL returns value like [1,5,8] (NOT a JSON string)
    if (typeof value === "string" && value.startsWith("[") && value.endsWith("]")) {
        try {
            return JSON.parse(
                value
                    .replace(/'/g, '"')    // replace single quotes with double quotes
                    .replace(/\s/g, "")    // remove spaces
            );
        } catch (e) {
            return [];
        }
    }

    // Default fallback
    try {
        return JSON.parse(value);
    } catch {
        return [];
    }
}

// ✅ Get One Task
exports.getTaskById = async (id) => {
    try {
        const task = await ToDoList.findOne({ where: { id: Number(id) } });
        if (!task) return { status: false, message: "Task not found" };
        return { status: true, data: task };
    } catch (error) {
        console.error("❌ getTaskById Error:", error);
        return { status: false, message: error.message };
    }
};

// ✅ Update Only Status
exports.updateTaskStatus = async (id, status) => {
    try {
        const updated = await ToDoList.update(
            { status },
            { where: { id: Number(id) } }
        );

        if (!updated[0])
            return { status: false, message: "Task not found" };

        return { status: true, message: "Status updated successfully" };
    } catch (error) {
        console.error("❌ updateTaskStatus Error:", error);
        return { status: false, message: error.message };
    }
};

// ⭐ Update Task Sort Orders in bulk
exports.updateSortOrder = async (sortOrderArray) => {
    try {
        if (!Array.isArray(sortOrderArray))
            return { status: false, message: "sortOrder must be an array" };

        let order = 1;

        for (let taskId of sortOrderArray) {
            await ToDoList.update(
                { sort_order: order },
                { where: { id: Number(taskId) } }
            );
            order++;
        }

        return { status: true, message: "Sort order updated successfully" };

    } catch (error) {
        console.error("❌ updateSortOrder Error:", error);
        return { status: false, message: error.message };
    }
};

// ✅ Delete Task (Soft or Hard based on your need)
exports.deleteTask = async (id) => {
    try {
        await ToDoList.destroy({ where: { id: Number(id) } });
        return { status: true, message: "Deleted successfully" };
    } catch (error) {
        console.error("❌ deleteTask Error:", error);
        return { status: false, message: error.message };
    }
};

// ✅ Update Task
// exports.updateTask = async (id, data) => {
//     try {
//         const updated = await ToDoList.update(data, {
//             where: { id: Number(id) },
//             returning: true,
//         });
//         return { status: true, message: "Updated successfully" };
//     } catch (error) {
//         console.error("❌ updateTask Error:", error);
//         return { status: false, message: error.message };
//     }
// };
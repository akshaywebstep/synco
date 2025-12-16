const { ToDoList, Admin, sequelize, Comment } = require("../../../../models")
const debug = require("debug")("service:comments");
const DEBUG = process.env.DEBUG === "true";
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

// =============================================
// LIST TASKS (FULLY FIXED VERSION)
// =============================================
exports.listTasks = async (createdBy) => {
    if (!createdBy || isNaN(Number(createdBy))) {
        return { status: false, message: "Invalid super admin ID", data: {} };
    }

    try {
        const tasks = await ToDoList.findAll({
            where: { created_by: Number(createdBy) },
            order: [
                ["sort_order", "ASC"],
                ["id", "DESC"]
            ],
            raw: true,
        });

        const grouped = {
            to_do: [],
            in_progress: [],
            in_review: [],
            completed: [],
        };

        const adminIdsSet = new Set();

        // Collect admin IDs
        tasks.forEach(task => {
            const creatorId = task.created_by ?? task.createdBy;
            if (creatorId) adminIdsSet.add(Number(creatorId));

            // Always use safeJson (never JSON.parse directly)
            const assignedArray = safeJson(task.assignedAdmins || task.assigned_admins);

            assignedArray.forEach(id => adminIdsSet.add(Number(id)));
        });

        const adminIds = Array.from(adminIdsSet);

        // Fetch all required admins
        const admins = await Admin.findAll({
            where: { id: adminIds },
            attributes: ["id", "firstName", "lastName", "profile"],
            raw: true,
        });

        // Build admin map
        const adminMap = Object.fromEntries(
            admins.map(a => [
                String(a.id),
                {
                    id: a.id,
                    name: `${a.firstName} ${a.lastName}`.trim(),
                    profile: a.profile
                }
            ])
        );

        // Process tasks
        for (let task of tasks) {
            task.sortOrder = task.sort_order ?? 0;

            // FIXED ✔ attachments parse
            task.attachments = parseAttachments(task.attachments);

            // Assigned admins → full objects
            let parsed = safeJson(task.assignedAdmins || task.assigned_admins);
            const assignedIds = Array.isArray(parsed) ? parsed : [];
            task.assignedAdmins = assignedIds.map(id => {
                const key = String(id);
                return adminMap[key] || {
                    id,
                    name: "Unknown",
                    profile: "/reportsIcons/Avatar.png"
                };
            });

            // FIXED ✔ creator details
            const creatorId = task.created_by ?? task.createdBy;
            const creatorKey = String(creatorId);

            // CreatedByDetails → always match admin table
            task.createdByDetails = adminMap[creatorKey]
                ? adminMap[creatorKey]
                : {
                    id: creatorId,
                    name: "Unknown",
                    profile: "/reportsIcons/Avatar.png"
                };

            // Group by status
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

// ========== Parsers ==========

function parseAttachments(value) {
    return parseJSON(value);
}
function parseAssignedAdmins(value) {
    return parseJSON(value).map(v => Number(v));
}

function parseJSON(value) {
    if (!value) return [];

    if (Array.isArray(value)) return value;

    if (typeof value !== "string") return [];

    let cleaned = value.trim();   // FIXES leading/trailing spaces

    // remove wrapping quotes
    if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
        cleaned = cleaned.slice(1, -1).trim();
    }

    // remove double escaping
    cleaned = cleaned.replace(/\\"/g, '"').replace(/\\\\/g, '\\');

    try {
        return JSON.parse(cleaned);
    } catch (e) {
        console.log("JSON Parse Failed:", cleaned);
        return [];
    }
}
// ----------------------------------------------------
// Helper To Safely Parse JSON
// ----------------------------------------------------
function safeJson(value) {
    if (!value) return [];

    if (Array.isArray(value)) return value;

    if (typeof value === "string") {

        let v = value.trim();

        // Remove wrapping quotes around the WHOLE JSON string
        if (v.startsWith('"') && v.endsWith('"')) {
            v = v.slice(1, -1);
        }

        // Now parse JSON arrays like [136]
        try {
            const parsed = JSON.parse(
                v.replace(/'/g, '"')   // fix single quotes
            );
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    return [];
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
            const [updatedRows] = await ToDoList.update(
                { sortOrder: order }, // use model field name
                { where: { id: Number(taskId) } }
            );
            console.log(`Task ID ${taskId} updated rows: ${updatedRows}`);
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

// exports.addCommentForToDo = async ({ commentBy = null, comment, commentType = "to do", serviceType = "to do" }) => {
//     const transaction = await sequelize.transaction();
//     try {
//         if (DEBUG) debug("🔍 Starting addCommentForFreeTrial service...");

//         let admin = null;

//         // Validate admin if provided
//         if (commentBy) {
//             admin = await Admin.findByPk(commentBy, { transaction });
//             if (!admin) {
//                 await transaction.rollback();
//                 if (DEBUG) debug("❌ Admin not found:", commentBy);
//                 return { status: false, message: "Admin not found." };
//             }
//             if (DEBUG) debug("✅ Admin validated:", admin.id);
//         }

//         // Create comment
//         const newComment = await Comment.create({ commentBy, comment, commentType, serviceType }, { transaction });
//         if (DEBUG) debug("✅ Comment created:", newComment.id);

//         await transaction.commit();
//         if (DEBUG) debug("🎉 Transaction committed successfully");

//         return {
//             status: true,
//             message: "Comment added successfully.",
//             data: { comment: newComment, admin },
//         };
//     } catch (error) {
//         await transaction.rollback();
//         if (DEBUG) debug("❌ addCommentForToDo Error:", error);
//         return { status: false, message: error.message };
//     }
// };
// exports.listCommentsForToDo = async ({ commentType = "to do", serviceType = "to do" }) => {
//     try {
//         debug("🔍 Starting listComments service...");

//         const comments = await Comment.findAll({
//             where: {
//                 commentType,
//                 serviceType,  // ⭐ FILTER BY SERVICETYPE
//             },
//             include: [
//                 {
//                     model: Admin,
//                     as: "bookedByAdmin",
//                     attributes: ["id", "firstName", "lastName", "email", "roleId", "status", "profile"],
//                     required: false,
//                 },
//             ],
//             order: [["createdAt", "DESC"]],
//         });

//         return {
//             status: true,
//             message: "✅ Comments fetched successfully",
//             data: comments,
//         };
//     } catch (error) {
//         return { status: false, message: error.message };
//     }
// };

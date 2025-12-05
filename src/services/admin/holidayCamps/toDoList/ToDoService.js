const { ToDoList, Admin,sequelize, Comment } = require("../../../../models")
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
        // Fetch tasks
        const tasks = await ToDoList.findAll({
            where: { created_by: Number(createdBy) },
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

        // Collect creator + assigned admin IDs
        const adminIdsSet = new Set();

        tasks.forEach(task => {
            // Creator ID (handles created_by or createdBy)
            const creatorId = task.created_by ?? task.createdBy;
            if (creatorId) adminIdsSet.add(Number(creatorId));

            // Assigned admins
            let assigned = task.assignedAdmins || task.assigned_admins;
            if (typeof assigned === "string") {
                try { assigned = JSON.parse(assigned.replace(/'/g, '"')); }
                catch { assigned = []; }
            }

            if (!Array.isArray(assigned)) assigned = [];
            assigned.forEach(id => adminIdsSet.add(Number(id)));
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
            task.attachments = safeJson(task.attachments);

            // Assigned admins → full objects
            const assignedIds = safeJson(task.assignedAdmins || task.assigned_admins) || [];
            task.assignedAdmins = assignedIds.map(id => {
                const key = String(id);
                return adminMap[key] || {
                    id,
                    name: "Unknown",
                    profile: "/reportsIcons/Avatar.png"
                };
            });

            // Creator ID
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

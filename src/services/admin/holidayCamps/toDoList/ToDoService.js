// const { ToDoList } = require("../../../../models/admin/holidayCamps/toDoList");

const { ToDoList } = require("../../../../models")
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
            data: [],
        };
    }

    try {
        const tasks = await ToDoList.findAll({
            where: { createdBy: Number(createdBy) },
            order: [["id", "DESC"]],
        });
        return { status: true, data: tasks };
    } catch (error) {
        console.error("❌ listTasks Error:", error);
        return { status: false, message: error.message, data: [] };
    }
};

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

// ✅ Update Task
exports.updateTask = async (id, data) => {
    try {
        const updated = await ToDoList.update(data, {
            where: { id: Number(id) },
            returning: true,
        });
        return { status: true, message: "Updated successfully" };
    } catch (error) {
        console.error("❌ updateTask Error:", error);
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

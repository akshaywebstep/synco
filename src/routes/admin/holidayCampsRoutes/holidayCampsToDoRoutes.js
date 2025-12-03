const express = require("express");
const router = express.Router();
const authMiddleware = require("../../../middleware/admin/authenticate");
const permissionMiddleware = require("../../../middleware/admin/permission");

const {
  createTask, listTasks, getTaskById, updateTaskStatus, deleteTask,updateSortOrder,
} = require("../../../controllers/admin/holidayCamps/toDoList/ToDoController");

router.post(
  "/create",
  authMiddleware,
  permissionMiddleware("to-do", "create"),
  createTask
);

router.get(
  "/list",
  authMiddleware,
  permissionMiddleware("to-do", "view-listing"),
  listTasks
);

router.get(
  "/view/:id",
  authMiddleware,
  permissionMiddleware("to-do", "view-one"),
  getTaskById
);

router.put(
  "/update-status",
  authMiddleware,
  permissionMiddleware("to-do", "update"),
  updateTaskStatus
);

router.put(
  "/update-sort-order",
  authMiddleware,
  permissionMiddleware("to-do", "update"),
  updateSortOrder
);

router.delete(
  "/delete/:id",
  authMiddleware,
  permissionMiddleware("to-do", "delete"),
  deleteTask
);

module.exports = router;

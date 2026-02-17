const express = require("express");
const router = express.Router();
const authMiddleware = require("../../middleware/admin/authenticate");
const permissionMiddleware = require("../../middleware/admin/permission");

const {
  createTerm,
  getAllTerms,
  getTermById,
  updateTerm,
  deleteTerm,
} = require("../../controllers/admin/termAndDates/termsController");

// ➕ Create Term

router.post(
  "/",
  authMiddleware,
  permissionMiddleware("term", "create"),
  createTerm
);

// 📥 Get All Terms
router.get(
  "/",
  authMiddleware,
  permissionMiddleware("term", "view-listing"),
  getAllTerms
);

// 🔍 Get Term by ID
router.get(
  "/:id",
  authMiddleware,
  permissionMiddleware("term", "view-listing"),
  getTermById
);

// ✏️ Update Term
router.put(
  "/:id",
  authMiddleware,
  permissionMiddleware("term", "update"),
  updateTerm
);

// 🗑️ Delete Term
router.delete(
  "/:id",
  authMiddleware,
  permissionMiddleware("term", "delete"),
  deleteTerm
);

module.exports = router;

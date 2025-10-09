const express = require("express");
const router = express.Router();
const multer = require("multer");
const fs = require("fs");

const authMiddleware = require("../../../middleware/admin/authenticate");
const permissionMiddleware = require("../../../middleware/admin/permission");

// ✅ Multer in-memory storage for banner & video uploads
const upload = multer();

const {
  getAllSessionPlanGroupStructure,
  repinSessionPlanGroup,
  getSessionPlanGroupStructureById,
  createSessionPlanGroupStructure,

} = require("../../../controllers/admin/oneToOne/sessionPlanLibrary/sessionPlanGroupController");

// ✅ Get All Session Plan Groups

router.post(
  "/session-plan-struture/create",
  authMiddleware,
  permissionMiddleware("session-plan-structure", "create"),
  createSessionPlanGroupStructure
);

router.get(
  "/session-plan-struture/listing",
  authMiddleware,
  permissionMiddleware("session-plan-structure", "view-listing"),
  getAllSessionPlanGroupStructure
);

router.get(
  "/session-plan-struture/listing/:id",
  authMiddleware,
  permissionMiddleware("session-plan-structure", "view-listing"),
  getSessionPlanGroupStructureById
);

router.put(
  "/session-plan-struture/:id/repin",
  authMiddleware,
  permissionMiddleware("session-plan-structure", "repin"),
  repinSessionPlanGroup
);

module.exports = router;

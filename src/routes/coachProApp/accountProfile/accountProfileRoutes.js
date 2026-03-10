const express = require("express");
const router = express.Router();
const authMiddleware = require("../../../middleware/admin/authenticate");
const multer = require("multer");
const upload = multer();
const coachProfile = require(
    "../../../controllers/admin/administration/adminPannel/adminController"
);   

// ✅ Get a specific admin / coach / super admin profile
router.get("/:id", authMiddleware, coachProfile.getAdminProfile);

// ✅ Update a specific coach profile
router.put("/update/:id", upload.fields([
    { name: "profile", maxCount: 1 },
    { name: "fa_level_1", maxCount: 1 },
    { name: "futsal_level_1_qualification", maxCount: 1 },
    { name: "first_aid", maxCount: 1 },
    { name: "futsal_level_1", maxCount: 1 },
  ]), 
  authMiddleware, coachProfile.updateAdmin);



module.exports = router;

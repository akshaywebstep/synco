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
router.put("/update/:id", upload.single("profile"), authMiddleware, coachProfile.updateAdmin);

module.exports = router;
// dsad
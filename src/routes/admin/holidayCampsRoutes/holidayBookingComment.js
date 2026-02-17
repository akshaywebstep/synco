const express = require("express");
const router = express.Router();
const authMiddleware = require("../../../middleware/admin/authenticate");
const permissionMiddleware = require("../../../middleware/admin/permission");

const {
  addCommentForHolidayCamp,
  listCommentsForHolidayCamp,
} = require("../../../controllers/admin/holidayCamps/booking/holidayCommentController");

// ================= COMMENTS =================
router.post(
  "/create",
  authMiddleware,
  permissionMiddleware("holiday-comment", "create"),
  addCommentForHolidayCamp
);

router.get(
  "/list",
  authMiddleware,
  permissionMiddleware("holiday-comment", "view-listing"),
  listCommentsForHolidayCamp
);

module.exports = router;

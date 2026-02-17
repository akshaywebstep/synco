const express = require("express");
const router = express.Router();
const authMiddleware = require("../../../middleware/admin/authenticate");

const permissionMiddleware = require("../../../middleware/admin/permission");
const {
 listReferrals
} = require("../../../controllers/admin/referals/referalController");

router.get(
  "/list",
  authMiddleware,
  permissionMiddleware("referal", "view-listing"),
  listReferrals
);

module.exports = router;

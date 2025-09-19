const express = require("express");
const router = express.Router();
const authMiddleware = require("../../middleware/admin/authenticate");
const permissionMiddleware = require("../../middleware/admin/permission");

const {
  createCredit,
  getAllCredits,
} = require("../../controllers/admin/booking/creditsController");

router.post(
  "/",
  authMiddleware,
  permissionMiddleware("credits", "create"),
  createCredit
);

router.get(
  "/",
  authMiddleware,
  permissionMiddleware("credits", "view-listing"),
  getAllCredits
);
module.exports = router;

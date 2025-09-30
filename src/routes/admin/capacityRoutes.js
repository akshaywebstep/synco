const express = require("express");
const router = express.Router();
const authMiddleware = require("../../middleware/admin/authenticate");
const permissionMiddleware = require("../../middleware/admin/permission");

const {
  getAllBookings,
} = require("../../controllers/admin/booking/capacityController");

router.get(
  "/",
  authMiddleware,
  permissionMiddleware("capacity", "view-listing"),
  getAllBookings
);

module.exports = router;

const express = require("express");
const router = express.Router();
const openParam = require("../../middleware/open");
const authMiddleware = require("../../middleware/admin/authenticate");

// Find  Class Module Base Route
router.use("/auth", require("./authRoutes"));
router.use("/account-profile", require("./accountProfileRoutes"));
router.use("/booking", require("./bookingRoutes"));

// Find A Holiday Camp
router.use("/holiday", require("./holidayRoutes"));
router.use("/student-course", require("./studentCourseRoutes"));

module.exports = router;

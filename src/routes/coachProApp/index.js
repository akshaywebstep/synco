const express = require("express");
const router = express.Router();
const authMiddleware = require("../../middleware/admin/authenticate");

// Find  Class Module Base Route
router.use("/auth", require("./auth/authRoutes"));
router.use("/account-profile", authMiddleware, require("./accountProfile/accountProfileRoutes"));

module.exports = router;

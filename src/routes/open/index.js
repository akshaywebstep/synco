const express = require("express");
const router = express.Router();

// Find  Class Module Base Route
router.use("/find-class", require("./findClassRoutes"));

module.exports = router;

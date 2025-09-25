const express = require("express");
const router = express.Router();

// Find  Class Module Base Route
router.use("/find-class", require("./findClassRoutes"));

// Book Free Trials Module Base Routes
router.use("/book/free-trials", require("./bookFreeTrailsRoutes"));

// Waiting List Module Base Routes
router.use("/waiting-list", require("./waitingListRoutes"));

module.exports = router;

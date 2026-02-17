const express = require("express");
const router = express.Router();

router.use("/payment", require("./payment"));

// Mount sub-routes here

module.exports = router;

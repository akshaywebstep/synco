const express = require("express");
const router = express.Router();

router.use("/pay360", require("./pay360"));

// Mount sub-routes here

module.exports = router;

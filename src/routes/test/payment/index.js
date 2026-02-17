const express = require("express");
const router = express.Router();

router.use("/pay360", require("./pay360"));

router.use("/stripe", require("./stripe"));

// Mount sub-routes here

module.exports = router;

const express = require("express");
const router = express.Router();

router.use("/country", require("./countryRoutes"));
router.use("/state", require("./stateRoutes"));
router.use("/city", require("./cityRoutes"));

// Mount sub-routes here

module.exports = router;

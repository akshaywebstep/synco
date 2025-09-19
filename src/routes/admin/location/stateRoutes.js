const express = require("express");
const router = express.Router({ mergeParams: true });
const authMiddleware = require("../../../middleware/admin/authenticate");

const {
  getAllStates,
} = require("../../../controllers/location/stateController");

router.get("/", authMiddleware, getAllStates);

module.exports = router;

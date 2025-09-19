const express = require("express");
const router = express.Router({ mergeParams: true });
const authMiddleware = require("../../middleware/admin/authenticate");

const {
  getAllStates,
  getAllCitiesOfState,
} = require("../../controllers/location/stateController");

router.get("/", getAllStates);
router.get("/:stateId/city", getAllCitiesOfState);

module.exports = router;

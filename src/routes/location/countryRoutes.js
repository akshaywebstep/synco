const express = require("express");
const router = express.Router({ mergeParams: true });
const authMiddleware = require("../../middleware/admin/authenticate");

const {
  getAllCountries,
  getAllStatesOfCountry,
} = require("../../controllers/location/countryController");

router.get("/", getAllCountries);
router.get("/:countryId/state", getAllStatesOfCountry);

module.exports = router;

const express = require("express");
const router = express.Router({ mergeParams: true });
const authMiddleware = require("../../../middleware/admin/authenticate");

const {
  getAllCities
} = require("../../../controllers/location/cityController");


router.get("/", authMiddleware, getAllCities);

module.exports = router;

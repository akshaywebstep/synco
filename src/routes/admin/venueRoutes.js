const express = require("express");
const router = express.Router();
const authMiddleware = require("../../middleware/admin/authenticate");
const permissionMiddleware = require("../../middleware/admin/permission");

const {
  createVenue,
  getAllVenues,
  getVenueById,
  updateVenue,
  deleteVenue,
} = require("../../controllers/admin/venue/venueController");

router.post(
  "/",
  authMiddleware,
  permissionMiddleware("venue", "create"),
  createVenue
);
router.get(
  "/",
  authMiddleware,
  permissionMiddleware("venue", "view-listing"),
  getAllVenues
);
router.get(
  "/:id",
  authMiddleware,
  permissionMiddleware("venue", "view-listing"),
  getVenueById
);
router.put(
  "/:id",
  authMiddleware,
  permissionMiddleware("venue", "update"),
  updateVenue
);
router.delete(
  "/:id",
  authMiddleware,
  permissionMiddleware("venue", "delete"),
  deleteVenue
);

module.exports = router;

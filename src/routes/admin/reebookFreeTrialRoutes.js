const express = require("express");
const router = express.Router();
const authMiddleware = require("../../middleware/admin/authenticate");
const permissionMiddleware = require("../../middleware/admin/permission");

const {
  createRebookingTrial,
  getAllRebookingTrials,
  sendRebookingEmail,
} = require("../../controllers/admin/booking/reebookFreeTrialController");

// POST → create a rebooking
router.post(
  "/",
  authMiddleware,
  permissionMiddleware("rebooking", "create"),
  createRebookingTrial
);

// GET → get all rebookings for a booking
router.get(
  "/",
  authMiddleware,
  permissionMiddleware("rebooking", "view-listing"),
  getAllRebookingTrials
);
router.post(
  "/trial/send-email",
  authMiddleware,
  permissionMiddleware("rebooking", "view-listing"),
  sendRebookingEmail
);

module.exports = router;

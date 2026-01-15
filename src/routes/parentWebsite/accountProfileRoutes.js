const express = require("express");
const router = express.Router();
const authMiddleware = require("../../middleware/admin/authenticate");
const {
  getCombinedBookingsByParentAdminId
} = require("../../controllers/admin/parentWebsite/accountProfileController");

// Verify-login
router.get("/:paremtAdminId", authMiddleware, getCombinedBookingsByParentAdminId); 

module.exports = router;

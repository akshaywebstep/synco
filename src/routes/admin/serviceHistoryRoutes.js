// const express = require("express");
// const router = express.Router();
// const authMiddleware = require("../../middleware/admin/authenticate");
// const permissionMiddleware = require("../../middleware/admin/permission");

// const {
//   // getSelectedBookFreeTrials,
//   getAccountProfile,
//   updateBooking,
// } = require("../../controllers/admin/booking/serviceHistoryController");

// // router.get("/selected/:id", authMiddleware, getSelectedBookFreeTrials);
// router.get(
//   "/account-profile/:id",
//   authMiddleware,
//   permissionMiddleware("service-history", "view-listing"),
//   getAccountProfile
// );
// router.put(
//   "/trial-to-membership/:id",
//   authMiddleware,
//   permissionMiddleware("book-membership", "update"),
//   updateBooking
// );
// module.exports = router;

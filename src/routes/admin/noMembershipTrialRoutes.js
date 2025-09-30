// const express = require("express");
// const router = express.Router();
// const authMiddleware = require("../../middleware/admin/authenticate");
// const permissionMiddleware = require("../../middleware/admin/permission");

// const {
//   createNoMembershipTrial,
//   getNoMembershipTrials,
//   sendNoMembershipTrialEmail,
// } = require("../../controllers/admin/booking/noMembershipTrialController");

// router.post(
//   "/",
//   authMiddleware,
//   permissionMiddleware("no-membership-trial", "create"),
//   createNoMembershipTrial
// );
// router.get(
//   "/",
//   authMiddleware,
//   permissionMiddleware("no-membership-trial", "view-listing"),
//   getNoMembershipTrials
// );
// router.post(
//   "/send-email/",
//   authMiddleware,
//   permissionMiddleware("no-membership-trial", "view-listing"),
//   sendNoMembershipTrialEmail
// );

// module.exports = router;

const express = require("express");
const router = express.Router();
const authMiddleware = require("../../middleware/admin/authenticate");
const permissionMiddleware = require("../../middleware/admin/permission");

const {
  createAdmin,
  getAllAdmins,
  updateAdmin,
  changeAdminStatus,
  deleteAdmin,
  getAdminProfile,
  resetPassword,
  getAllAdminsForReassign,
} = require("../../controllers/admin/administration/adminPannel/adminController");

const {
  getAllAgents,
} = require("../../controllers/admin/booking/bookFreeTrialController");

const {
  assignLeadToAgent,
} = require("../../controllers/admin/recruitment/franchise/franchiseRecruitmentLeadController");

const multer = require("multer");
const upload = multer();

// Role Module Base Route
router.use("/role", require("./roleRoutes"));

// Permission Module Base  Route
router.use("/permission", require("./permissionRoutes"));

// Notifications Module Base  Route
router.use("/notification", require("./notificationRoutes"));
// Custom-Notification Module Base Route
router.use("/custom-notification", require("./customNotification"));

// Payment Plan  Module Base Route
router.use("/payment-plan", require("./paymentPlanRoutes"));
// Payment Group Module Base Route
router.use("/payment-group", require("./paymentGroupRoutes"));

// Discount  Module Base Route
router.use("/discount", require("./discountRoutes"));

// Weekly Classes Module Base Route
router.use("/weekly-class", require("./weeklyClasseRoutes"));

// Session Plan Group Base Route
router.use("/session-plan-group", require("./sessionPlanGroupRoutes"));
// Session Plan Exercise Base Route
router.use("/session-plan-exercise", require("./sessionExerciseRoutes"));

// Term Group Module Base Route
router.use("/term-group", require("./termGroupRoutes"));
// Terms Module Base Route
router.use("/term", require("./termRoutes"));

// Venue Module Base Route
router.use("/venue", require("./venueRoutes"));

//  Class Schedule Module Base Route
router.use("/class-schedule", require("./classScheduleRoutes"));

//  Cancel Session Module Base Route
router.use("/cancel-session", require("./cancelSessionRoutes"));

// Find  Class Module Base Route
router.use("/find-class", require("./findClassRoutes"));

//  Dashboard Module Route
router.use("/dashboard", require("./dashboardRoutes"));

// Book Free Trials Module Base Routes
router.use("/book/free-trials", require("./bookFreeTrialsRoutes"));
router.use("/service-history", require("./serviceHistoryRoutes"));
router.use("/reebooking", require("./reebookFreeTrialRoutes"));
router.use("/cancel-freeTrial", require("./cancelBookingRoutes"));
router.use("/no-membership", require("./noMembershipTrialRoutes"));
router.use("/key-information", require("./keyInformationRoutes"));

// Book Membership Modle Base Routes
router.use("/book-membership", require("./bookingMembershipRoutes"));
router.use("/cancel-membership", require("./cancelMembershipBookingRoutes"));
router.use("/membership", require("./freezeBookingRoutes"));
router.use("/credits", require("./creditsRoutes"));

// Waiting List Module Base Routes
router.use("/waiting-list", require("./waitingListRoutes"));

// Capacity Moudle Base Route
router.use("/capacity", require("./capacityRoutes"));

// Cancellation Module Base Routes
router.use(
  "/cancellation/request-to-cancel",
  require("./requestToCancellationRoutes")
);
// full-cancellation  Base Routes
router.use(
  "/cancellation/full-cancellation",
  require("./fullCancellationRoutes")
);

// All Base Routes
router.use("/cancellation/all", require("./allListRoutes"));

// Global Search Module Base route
router.use("search/", require("./searchingRoutes"));

// Account Information Module Base Route
router.use("/account-information", require("./accountInformationRoutes"));

// Lead Mouldule Base Route
router.use("/lead", require("./leadRoutes"));

// one to one base routes
router.use("/one-to-one", require("./oneToOneRoutes/sessionPlanLibraryRoutes"));
router.use("/one-to-one", require("./oneToOneRoutes/sessionExerciseRoutes"));
router.use("/one-to-one", require("./oneToOneRoutes/oneToOneLeadRoutes"));
router.use("/one-to-one", require("./oneToOneRoutes/oneToOneBookingRoutes"));

// birthday party base route
router.use(
  "/birthday-party",
  require("./birthdayPartyRoutes/sessionExerciseRoutes")
);
router.use(
  "/birthday-party",
  require("./birthdayPartyRoutes/sessionPlanLibraryRoutes")
);
router.use(
  "/birthday-party",
  require("./birthdayPartyRoutes/birthdayPartyLeadRoutes")
);
router.use(
  "/birthday-party",
  require("./birthdayPartyRoutes/birthdayPartyBookingRoutes")
);

const {
  listComments,
} = require("../../controllers/admin/booking/commentController");
const { route } = require("./rolePermissionRoutes");

router.get(
  "/comment/allComment",
  authMiddleware,
  permissionMiddleware("comment", "view-listing"),
  listComments
);

// Holiday camps
// Session Plan Group Base Route
router.use(
  "/holiday/session-plan-group",
  require("./holidayCampsRoutes/holidaySessionPlanGroupRoutes")
);
// Session Plan Exercise Base Route
router.use(
  "/holiday/session-plan-exercise",
  require("./holidayCampsRoutes/holidaySessionExerciseRoutes")
);

// Term Group Base Route
router.use("/holiday/camp", require("./holidayCampsRoutes/holidayCampRoutes"));
// Term Base Route
router.use(
  "/holiday/campDate",
  require("./holidayCampsRoutes/holidayCampDateRoutes")
);

// Term Group Base Route
router.use(
  "/holiday/payment-plan",
  require("./holidayCampsRoutes/holidayPaymentPlanRoutes")
);
// Term Base Route
router.use(
  "/holiday/payment-group",
  require("./holidayCampsRoutes/holidayPaymentGroupRoutes")
);

router.use(
  "/holiday/venue",
  require("./holidayCampsRoutes/holidayVenueRoutes")
);

router.use(
  "/holiday/class-schedule",
  require("./holidayCampsRoutes/holidayClassScheduleRoutes")
);
router.use(
  "/holiday/cancel-session",
  require("./holidayCampsRoutes/holidayCancelSessionRoutes.js")
);

router.use(
  "/holiday/find-class",
  require("./holidayCampsRoutes/holidayFindClassRoutes")
);

router.use(
  "/holiday/booking",
  require("./holidayCampsRoutes/holidayBookingRoutes")
);
router.use(
  "/holiday/comment",
  require("./holidayCampsRoutes/holidayBookingComment")
);

router.use(
  "/holiday/template-category",
  require("./templates/templateCategoryRoutes")
);
router.use(
  "/holiday/custom-template",
  require("./templates/customTemplateRoute")
);
router.use("/holiday/to-do-list", require("./administration/toDoRoutes"));

router.use("/folder", require("./administration/folderRoutes"));
router.use("/folder", require("./administration/filesRoutes"));

router.use(
  "/coach/recruitment",
  require("./recruitmentRoutes/coachRecruitmentRoutes")
);
router.use(
  "/coach/candidate-profile",
  require("./recruitmentRoutes/coachCandidateProfileRoutes")
);

router.use(
  "/venue-manager/recruitment/",
  require("./recruitmentRoutes/vmRecruitmentRoutes")
);
router.use(
  "/venue-manager/candidate-profile",
  require("./recruitmentRoutes/vmCandidateProfileRoutes")
);

router.use(
  "/franchise/recruitment/",
  require("./recruitmentRoutes/franchiseRecruitmentRoutes")
);
router.use(
  "/franchise/candidate-profile",
  require("./recruitmentRoutes/franchiseCandidateProfileRoutes")
);

router.use(
  "/coach-profile/venue-allocate/",
  require("./coach/coachProfileRoutes")
);
router.use("/music-player/", require("./coach/musicPlayerRoutes"));
router.use("/course/", require("./coach/courseRoutes"));

router.use("/contract/", require("./coach/contractRoutes"));
router.use("/student-course/", require("./coach/studentCourseRoutes"));
router.use("/feedback/", require("./feedbackRoutes"));

// Send Text Routes
// router.use("/send/", require("./sendTextAllBookingRoutes/sendTextRoutes"));

// Base: /api/admin/admin
// Assign Agent List
router.get(
  "/get-agents",
  authMiddleware,
  permissionMiddleware("member", "view-listing"),
  getAllAgents
);

router.put(
  "/assign-franchise",
  authMiddleware,
  permissionMiddleware("recruitment-lead-franchise", "view-listing"),
  assignLeadToAgent
);
router.post(
  "/",
  // upload.single("profile")
  upload.fields([
    { name: "profile", maxCount: 1 },
    { name: "fa_level_1", maxCount: 1 },
    { name: "futsal_level_1_qualification", maxCount: 1 },
    { name: "first_aid", maxCount: 1 },
    { name: "futsal_level_1", maxCount: 1 },
  ]),
  authMiddleware,
  permissionMiddleware("member", "create"),
  createAdmin
);
router.get(
  "/",
  authMiddleware,
  permissionMiddleware("member", "view-listing"),
  getAllAdmins
);
router.get(
  "/:id",
  authMiddleware,
  permissionMiddleware("member", "view-listing"),
  getAdminProfile
);
router.put(
  "/:id",
  upload.single("profile"),
  authMiddleware,
  permissionMiddleware("member", "update"),
  updateAdmin
);
router.patch(
  "/:id/status",
  authMiddleware,
  permissionMiddleware("member", "view-listing"),
  changeAdminStatus
);
router.delete(
  "/:id",
  authMiddleware,
  permissionMiddleware("member", "delete"),
  deleteAdmin
);

router.get(
  "/reassign/data",
  authMiddleware,
  permissionMiddleware("member", "view-listing"),
  getAllAdminsForReassign
);

// ✅ Reset password
router.post("/reset-password", resetPassword);

// Mount sub-routes here

module.exports = router;

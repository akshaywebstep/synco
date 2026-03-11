const express = require("express");
const router = express.Router();
const authMiddleware = require("../../middleware/admin/authenticate");
const  coachContract  = require("../../controllers/admin/coaches/contractController");
const courseService = require("../../controllers/admin/coaches/courseController");

// Find  Class Module Base Route
router.use("/auth", require("./auth/authRoutes"));
router.use("/account-profile", authMiddleware, require("./accountProfile/accountProfileRoutes"));


router.get("/contracts",authMiddleware, coachContract.getAllCoachesContracts); 
router.post("/contracts/assign", authMiddleware, coachContract.assignContractToCoach);
router.post("/course/result", authMiddleware, courseService.submitCourseController);

module.exports = router;

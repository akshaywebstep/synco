const express = require("express");
const router = express.Router();
const authMiddleware = require("../../middleware/admin/authenticate");
const  coachContract  = require("../../controllers/admin/coaches/contractController");

// Find  Class Module Base Route
router.use("/auth", require("./auth/authRoutes"));
router.use("/account-profile", authMiddleware, require("./accountProfile/accountProfileRoutes"));


router.get("/contracts",authMiddleware, coachContract.getAllCoachesContracts); 
router.post("/contracts/assign", authMiddleware, coachContract.assignContractToCoach);

module.exports = router;

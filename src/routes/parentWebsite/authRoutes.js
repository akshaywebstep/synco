const express = require("express");
const router = express.Router();
const authMiddleware = require("../../middleware/admin/authenticate");
const {
  login,
  forgetPassword,
  verifyLogin,
  resetPasswordUsingToken,
} = require("../../controllers/admin/authController");

const {
  getAdminProfile,
} = require("../../controllers/admin/administration/adminPannel/adminController");

//Login 
router.post("/login", login);
//Forgot Password 
router.post("/password/forget", forgetPassword); 
// Verify-login
router.get("/login/verify", authMiddleware, verifyLogin); 
//verify-otp and Reset-password route
router.post("/password/reset", resetPasswordUsingToken); 
// Get Parent byId
router.get("/profile/:id", authMiddleware, getAdminProfile); 

module.exports = router;

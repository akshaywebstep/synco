const express = require("express");
const router = express.Router();
const authMiddleware = require("../../middleware/admin/authenticate");

const {
  register,
  login,
  verifyLogin,
  profile,
  forgetPassword,
  resetPasswordUsingToken,
  logout,
} = require("../../controllers/admin/authController");

router.post("/register", register); //register route
router.post("/login", login); // login route
router.get("/login/verify", authMiddleware, verifyLogin); // login route
router.post("/password/forget", forgetPassword); //forgot password route
router.post("/password/reset", resetPasswordUsingToken); //verify-otp and Reset-password route

module.exports = router;

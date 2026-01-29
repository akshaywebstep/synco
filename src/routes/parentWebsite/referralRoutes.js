const express = require("express");
const router = express.Router();

const authMiddleware = require("../../middleware/admin/authenticate");
const {
    createReferral,
    listReferrals,
} = require("../../controllers/admin/parentWebsite/referrralController");

router.post("/create", authMiddleware, createReferral);
router.get("/list", authMiddleware, listReferrals);

module.exports = router;

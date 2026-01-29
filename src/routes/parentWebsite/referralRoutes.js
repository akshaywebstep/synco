const express = require("express");
const router = express.Router();

const authMiddleware = require("../../middleware/admin/authenticate");
const {
    createReferral,
} = require("../../controllers/admin/parentWebsite/referrralController");

router.post("/create", authMiddleware, createReferral);

module.exports = router;

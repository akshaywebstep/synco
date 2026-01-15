const express = require("express");
const router = express.Router({ mergeParams: true });

const {
    createReferral,
} = require("../../../controllers/admin/referrals/referrralController");

router.post("/create", createReferral);

module.exports = router;

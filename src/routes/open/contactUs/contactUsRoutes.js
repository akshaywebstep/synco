const express = require("express");
const router = express.Router({ mergeParams: true });

const {
    createContactUs,
} = require("../../../controllers/admin/contactUs/contactUsController");

router.post("/create", createContactUs);

module.exports = router;

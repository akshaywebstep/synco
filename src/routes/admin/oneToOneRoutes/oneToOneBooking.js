const express = require("express");
const router = express.Router();

const authMiddleware = require("../../../middleware/admin/authenticate");
const permissionMiddleware = require("../../../middleware/admin/permission");

const {
    createOnetoOneBooking,
} = require("../../../controllers/admin/oneToOne/booking/oneToOneBookingController");

// ✅ Get All Session Plan Groups

router.post(
    "/booking/create",
    authMiddleware,
    permissionMiddleware("one-to-one-lead", "create"),
    createOnetoOneBooking
);

module.exports = router;

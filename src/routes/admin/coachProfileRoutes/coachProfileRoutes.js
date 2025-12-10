const express = require("express");
const router = express.Router();

const authMiddleware = require("../../../middleware/admin/authenticate");
const permissionMiddleware = require("../../../middleware/admin/permission");

const {
    getAllCoaches,
    getCoachById,
    createAllocateVenue,
    updateAllocateVenue,
    deleteAllocateVenue,
} = require("../../../controllers/admin/coaches/coachProfileController");

// 📄 Get All Files
router.get(
    "/list/",
    authMiddleware,
    permissionMiddleware("coach", "view-listing"),
    getAllCoaches
);

router.get(
    "/listBy/:id",
    authMiddleware,
    permissionMiddleware("coach", "view-listing"),
    getCoachById
);

router.post(
    "/create",
    authMiddleware,
    permissionMiddleware("coach", "allocate-venue"),
    createAllocateVenue
);

router.put(
    "/update/:id",
    authMiddleware,
    permissionMiddleware("coach", "allocate-venue-update"),
    updateAllocateVenue
);

router.delete(
    "/delete/:id",
    authMiddleware,
    permissionMiddleware("coach", "allocate-venue-update"),
    deleteAllocateVenue
);
module.exports = router;

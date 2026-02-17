const express = require("express");
const router = express.Router();
const multer = require("multer");
const fs = require("fs");

const authMiddleware = require("../../../middleware/admin/authenticate");
const permissionMiddleware = require("../../../middleware/admin/permission");

// ✅ Multer in-memory storage for banner & video uploads
const upload = multer();

const {
    createHolidaySessionPlanGroup,
    getAllHolidaySessionPlanGroups,
    getHolidaySessionPlanGroupDetails,
    updateHolidaySessionPlanGroup,
    deleteHolidaySessionPlanGroup,
    deleteHolidaySessionPlanGroupLevel,
    reorderHolidaySessionPlanGroups,
    downloadHolidaySessionPlanGroupVideo,
    duplicateHolidaySessionPlanGroup,
} = require("../../../controllers/admin/holidayCamps/sessionPlan/holidaySessionPlanGroupController");

router.get(
    "/:id/download-video",
    authMiddleware,
    permissionMiddleware("holiday-session-plan-group", "view-listing"),
    downloadHolidaySessionPlanGroupVideo
);

// ✅ Create Session Plan Group
router.post(
    "/create",
    authMiddleware,
    upload.any(), // ✅ accept banner, video, AND dynamic recording_* fields
    permissionMiddleware("holiday-session-plan-group", "create"),
    createHolidaySessionPlanGroup
);

router.post(
    "/:id/duplicate",
    authMiddleware,
    upload.any(), // ✅ accept banner, video, AND dynamic recording_* fields
    permissionMiddleware("holiday-session-plan-group", "view-listing"),
    duplicateHolidaySessionPlanGroup
);
// ✅ Get All Session Plan Groups

router.get(
    "/list",
    authMiddleware,
    permissionMiddleware("holiday-session-plan-group", "view-listing"),
    getAllHolidaySessionPlanGroups
);

// ✅ Get Session Plan Group by ID
router.get(
    "/listBy/:id",
    authMiddleware,
    permissionMiddleware("holiday-session-plan-group", "view-listing"),
    getHolidaySessionPlanGroupDetails
);

// ✅ Update Session Plan Group
router.put(
    "/update/:id",
    authMiddleware,
    upload.any(),
    permissionMiddleware("holiday-session-plan-group", "update"),
    updateHolidaySessionPlanGroup
);

// ✅ Delete Session Plan Group
router.delete("/delete/:id", authMiddleware, permissionMiddleware("holiday-session-plan-group", "delete"), deleteHolidaySessionPlanGroup);

router.delete(
    "/:id/level/:levelKey",
    authMiddleware,
    permissionMiddleware("holiday-session-plan-group", "delete"),
    deleteHolidaySessionPlanGroupLevel
);
// ✅ Reorder Session Plan Groups
router.patch("/reorder", authMiddleware, reorderHolidaySessionPlanGroups);

module.exports = router;

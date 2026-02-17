const express = require("express");
const router = express.Router();
const authMiddleware = require("../../../middleware/admin/authenticate");
const permissionMiddleware = require("../../../middleware/admin/permission");
const multer = require("multer");

const upload = multer({ storage: multer.memoryStorage() });

const {
    createVmCandidateProfile
} = require("../../../controllers/admin/recruitment/venueManager/vmCandidateProfileController");

router.post(
    "/create",
    upload.fields([
        { name: "uploadCv", maxCount: 1 }
    ]),
    authMiddleware,
    permissionMiddleware("candidate_profile-venue-manager", "create"),
    createVmCandidateProfile
);

module.exports = router;

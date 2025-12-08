const express = require("express");
const router = express.Router();
const authMiddleware = require("../../../middleware/admin/authenticate");
const permissionMiddleware = require("../../../middleware/admin/permission");
const multer = require("multer");

const upload = multer({ storage: multer.memoryStorage() });

const {
    createFranchiseCandidateProfile
} = require("../../../controllers/admin/recruitment/franchise/franchiseCandidateProfileController");

router.post(
    "/create",
    upload.fields([
        { name: "uploadCv", maxCount: 1 }
    ]),
    authMiddleware,
    permissionMiddleware("franchise-candidate-profile", "create"),
    createFranchiseCandidateProfile
);

module.exports = router;

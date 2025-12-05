const express = require("express");
const router = express.Router();
const authMiddleware = require("../../../middleware/admin/authenticate");
const permissionMiddleware = require("../../../middleware/admin/permission");
const multer = require("multer");

const upload = multer({ storage: multer.memoryStorage() });

const {
    createCandidateProfile
} = require("../../../controllers/admin/recruitment/candidateProfileController");

router.post(
    "/create",
    upload.fields([
        { name: "uploadCv", maxCount: 1 }
    ]),
    authMiddleware,
    permissionMiddleware("candidate_profile", "create"),
    createCandidateProfile
);

// router.get(
//   "/list",
//   authMiddleware,
//   permissionMiddleware("recruitment-lead", "view-listing"),
//   getAllRecruitmentLead
// );

// router.get(
//   "/listBy/:id",
//   authMiddleware,
//   permissionMiddleware("recruitment-lead", "view-listing"),
//   getRecruitmentLeadById
// );

module.exports = router;

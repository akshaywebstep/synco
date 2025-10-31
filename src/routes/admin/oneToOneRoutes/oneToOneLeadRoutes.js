const express = require("express");
const router = express.Router();

const authMiddleware = require("../../../middleware/admin/authenticate");
const permissionMiddleware = require("../../../middleware/admin/permission");

const {
    createOnetoOneLeads,
    getAllOnetoOneLeads,
    getOnetoOneLeadsById,
} = require("../../../controllers/admin/oneToOne/oneToOneLeadsController");

// ✅ Get All Session Plan Groups

router.post(
    "/leads/create",
    authMiddleware,
    permissionMiddleware("one-to-one-lead", "create"),
    createOnetoOneLeads
);

router.get(
    "/leads/list",
    authMiddleware,
    permissionMiddleware("one-to-one-lead", "view-listing"),
    getAllOnetoOneLeads
);

router.get(
    "/leads/list/:id",
    authMiddleware,
    permissionMiddleware("one-to-one-lead", "view-listing"),
    getOnetoOneLeadsById
);

module.exports = router;

const express = require("express");
const router = express.Router();
const authMiddleware = require("../../middleware/admin/authenticate");
const permissionMiddleware = require("../../middleware/admin/permission");

const {
getAllKeyInformation,
    updateKeyInformation,

} = require("../../controllers/admin/booking/keyInformationController");

router.put(
    "/",
    authMiddleware,
    permissionMiddleware("key-information", "update"),
    updateKeyInformation
);

router.get(
    "/",
    authMiddleware,
    permissionMiddleware("key-information", "view-listing"),
    getAllKeyInformation
);

module.exports = router;

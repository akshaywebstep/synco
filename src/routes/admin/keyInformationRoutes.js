const express = require("express");
const router = express.Router();
const authMiddleware = require("../../middleware/admin/authenticate");
const permissionMiddleware = require("../../middleware/admin/permission");

const {
    getAllKeyInformation,
    updateKeyInformation,
    getKeyInformationByServiceType

} = require("../../controllers/admin/keyInformationController");

router.put(
    "/",
    authMiddleware,
    permissionMiddleware("key-information", "update"),
    updateKeyInformation
);

router.get(
    "/list",
    authMiddleware,
    permissionMiddleware("key-information", "view-listing"),
    getAllKeyInformation
);

router.get(
    "/listBy/:serviceType",
    authMiddleware,
    permissionMiddleware("key-information", "view-listing"),
    getKeyInformationByServiceType
);

module.exports = router;

const express = require("express");
const router = express.Router();
const authMiddleware = require("../../../middleware/admin/authenticate");
const permissionMiddleware = require("../../../middleware/admin/permission");
const {
    createCustomTemplate,
    listCustomTemplates,
    deleteCustomTemplate,
    updateCustomTemplate,
    getCustomTemplate
} = require("../../../controllers/admin/holidayCamps/EmailAndTextTemplates/customTemplate/customTemplateController");

router.post(
    "/create",
    authMiddleware,
    permissionMiddleware("holiday-custom-template", "create"),
    createCustomTemplate
);
router.get(
    "/list",
    authMiddleware,
    permissionMiddleware("holiday-custom-template", "view-listing"),
    listCustomTemplates
);
router.get(
  "/get/:id",
  authMiddleware,
  permissionMiddleware("holiday-custom-template", "view"),
  getCustomTemplate   // <-- your new controller
);
// ✅ Delete Route
router.delete(
    "/delete/:id",
    authMiddleware,
    permissionMiddleware("holiday-custom-template", "delete"),
    deleteCustomTemplate
);
// ✅ Update Route
router.put(
  "/update/:id",
  authMiddleware,
  permissionMiddleware("holiday-custom-template", "update"),
  updateCustomTemplate
);


module.exports = router;

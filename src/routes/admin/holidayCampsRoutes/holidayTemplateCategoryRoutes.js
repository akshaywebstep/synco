const express = require("express");
const router = express.Router();
const authMiddleware = require("../../../middleware/admin/authenticate");
const permissionMiddleware = require("../../../middleware/admin/permission");
const {
  createTemplateCategory, listTemplateCategories
  //   getAllHolidayVenues,

} = require("../../../controllers/admin/holidayCamps/EmailAndTextTemplates/templatecategory/templatecategoryController");

router.post(
  "/create",
  authMiddleware,
  permissionMiddleware("holiday-template-category", "create"),
  createTemplateCategory
);

router.get(
  "/list",
  authMiddleware,
  permissionMiddleware("holiday-template-category", "view-listing"),
  listTemplateCategories
);

module.exports = router;

// middleware/admin/permissionMiddleware.js
const adminRoleModel = require("../../services/admin/adminRole");

const DEBUG = process.env.DEBUG === "true";

/**
 * Middleware to check if the authenticated admin has permission to perform
 * a specific action on a module.
 *
 * Usage:
 * router.post("/route", authMiddleware, permissionMiddleware("moduleName", "actionName"), handler)
 *
 * @param {string} module - Name of the module
 * @param {string} action - Action name (e.g., 'create', 'update', 'delete', 'view')
 */
const permissionMiddleware = (module, action) => {
  return async (req, res, next) => {
    try {
      const admin = req.admin;

      if (!admin) {
        return res.status(401).json({
          status: false,
          message: "Admin not authenticated.",
          code: "UNAUTHORIZED",
        });
      }

      // DEBUG logging
      if (DEBUG)
        console.log(
          `🔍 Checking permission for adminId=${admin.id}, roleId=${admin.roleId}, module=${module}, action=${action}`
        );

      const result = await adminRoleModel.checkRolePermission(
        admin.roleId,
        module,
        action
      );

      if (!result.status) {
        // Permission denied
        return res.status(403).json({
          status: false,
          message: result.message,
          code: result.code || "INSUFFICIENT_PERMISSION",
        });
      }

      // Permission granted
      if (DEBUG) console.log(`✅ Permission granted:`, result.data);

      // Attach permission info to request (optional)
      req.permission = result.data;
      next();
    } catch (error) {
      console.error("❌ Permission middleware exception:", error);
      return res.status(500).json({
        status: false,
        message: "Something went wrong while verifying permissions.",
        code: "PERMISSION_CHECK_ERROR",
      });
    }
  };
};

module.exports = permissionMiddleware;

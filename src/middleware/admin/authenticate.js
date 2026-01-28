// const { getAdminById } = require("../../services/admin/administration/adminPannel/admin");
// const { verifyToken } = require("../../utils/jwt");

// const DEBUG = process.env.DEBUG === "true";

// /**
//  * Middleware to authenticate admins using JWT.
//  * Adds validated admin info to `req.admin`.
//  */
// const authMiddleware = async (req, res, next) => {
//   // console.log("🔍 Incoming request:", req.method, req.originalUrl);
//   try {
//     const authHeader = req.headers.authorization;
//     // console.log("🔍 Authorization header:", authHeader);

//     if (!authHeader || !authHeader.startsWith("Bearer ")) {
//       return res.status(401).json({
//         message: "Authorization token is missing or improperly formatted.",
//       });
//     }

//     const token = authHeader.split(" ")[1];
//     const result = verifyToken(token);

//     if (DEBUG) console.log(`result - `, result);

//     if (!result.success) {
//       let statusCode = 401;
//       if (result.message === "Token has expired.") {
//         statusCode = 403; // Forbidden - valid but expired
//       }

//       return res.status(statusCode).json({
//         message: result.message || "Unauthorized access.",
//         code: result.code || "AUTH_ERROR",
//       });
//     }

//     const { status, data: admin } = await getAdminById(result.payload.id);

//     if (!status || !admin) {
//       return res
//         .status(404)
//         .json({ message: "Admin associated with token not found." });
//     }
//     // ❌ Block suspended admins
//     if (admin.status === "suspend") {
//       return res.status(403).json({
//         status: false,
//         message: "Access denied. Your account has been suspended.",
//         code: "ACCOUNT_SUSPENDED",
//       });
//     }
//     // console.log("admindataaaa", admin);
//     if (DEBUG) {
//       console.table({
//         id: admin.id,
//         firstName: admin.firstName,
//         lastName: admin.lastName,
//         email: admin.email,
//         role: admin.role.role,
//         roleId: admin.role.id,
//       });
//     }

//     // Attach validated admin to request
//     req.admin = {
//       id: admin.id,
//       firstName: admin.firstName,
//       lastName: admin.lastName,
//       email: admin.email,
//       role: admin.role.role,
//       roleId: admin.role.id,
//       profile: admin.profile,
//     };

//     next();
//   } catch (error) {
//     console.error("❌ Auth middleware exception:", error);
//     return res.status(500).json({
//       message: "Something went wrong during authentication. Please try again.",
//     });
//   }
// };
// module.exports = authMiddleware;
const { getAdminById } = require("../../services/admin/administration/adminPannel/admin");
const { verifyToken } = require("../../utils/jwt");

const DEBUG = process.env.DEBUG === "true";

const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        message: "Authorization token is missing or improperly formatted.",
      });
    }

    const token = authHeader.split(" ")[1];
    const result = verifyToken(token);

    if (DEBUG) console.log("JWT result:", result);

    if (!result.success) {
      return res.status(result.message === "Token has expired." ? 403 : 401).json({
        message: result.message || "Unauthorized access.",
      });
    }

    const { status, data: admin } = await getAdminById(result.payload.id);

    if (!status || !admin) {
      return res.status(404).json({
        message: "User associated with token not found.",
      });
    }

    // ❌ Block suspended users
    if (admin.status === "suspend") {
      return res.status(403).json({
        message: "Access denied. Your account has been suspended.",
      });
    }

    const roleName = admin.role?.role?.toLowerCase();

    // ✅ If role is parent
    if (roleName === "parents") {
      req.parent = {
        id: admin.id,
        firstName: admin.firstName,
        lastName: admin.lastName,
        email: admin.email,
        profile: admin.profile,
      };

      req.user = { id: admin.id, type: "Parents" };
    }
    // ✅ Else treat as admin (admin / super admin)
    else {
      req.admin = {
        id: admin.id,
        firstName: admin.firstName,
        lastName: admin.lastName,
        email: admin.email,
        role: admin.role.role,
        roleId: admin.role.id,
        profile: admin.profile,
      };

      req.user = { id: admin.id, type: "Admin" };
    }

    if (DEBUG) {
      console.log("Authenticated as:", req.user.type);
    }

    next();
  } catch (error) {
    console.error("❌ Auth middleware exception:", error);
    return res.status(500).json({
      message: "Something went wrong during authentication.",
    });
  }
};

module.exports = authMiddleware;

const { getAdminById } = require("../../services/admin/administration/adminPannel/admin");
const { verifyToken } = require("../../utils/jwt");

const DEBUG = process.env.DEBUG === "true";

const parentAuthMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        message: "Authorization token is missing or improperly formatted.",
      });
    }

    const token = authHeader.split(" ")[1];
    const result = verifyToken(token);

    if (!result.success) {
      let statusCode = 401;
      if (result.message === "Token has expired.") {
        statusCode = 403;
      }
      return res.status(statusCode).json({
        message: result.message || "Unauthorized access.",
        code: result.code || "AUTH_ERROR",
      });
    }

    const { status, data: parent } = await getAdminById(result.payload.id);

    if (!status || !parent) {
      return res.status(404).json({ message: "Parent associated with token not found." });
    }

    if (parent.status === "suspend") {
      return res.status(403).json({
        status: false,
        message: "Access denied. Your account has been suspended.",
        code: "ACCOUNT_SUSPENDED",
      });
    }

    if (DEBUG) {
      console.table({
        id: parent.id,
        firstName: parent.firstName,
        lastName: parent.lastName,
        email: parent.email,
        role: parent.role.role,
        roleId: parent.role.id,
      });
    }

    // Attach validated parent to request
    req.parent = {
      id: parent.id,
      firstName: parent.firstName,
      lastName: parent.lastName,
      email: parent.email,
      role: parent.role.role,
      roleId: parent.role.id,
      profile: parent.profile,
    };

    next();
  } catch (error) {
    console.error("❌ Parent auth middleware exception:", error);
    return res.status(500).json({
      message: "Something went wrong during authentication. Please try again.",
    });
  }
};

module.exports = parentAuthMiddleware;

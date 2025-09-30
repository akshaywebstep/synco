const jwt = require("jsonwebtoken");

/**
 * Generates a JWT token with user details.
 *
 * @param {object} user - User object containing id, name, email.
 * @param {string} [expiresIn=process.env.JWT_EXPIRES_IN || "7d"] - Token expiration time.
 * @returns {string|null} - JWT token or null on failure.
 */
const createToken = (user, expiresIn = process.env.JWT_EXPIRES_IN || "7d") => {
  if (!process.env.JWT_SECRET) {
    console.error("❌ JWT_SECRET is missing in environment variables.");
    return null;
  }

  try {
    const { id, name, email } = user;
    const token = jwt.sign({ id, name, email }, process.env.JWT_SECRET, {
      expiresIn,
    });
    return token;
  } catch (err) {
    console.error("❌ Error generating token:", err);
    return null;
  }
};

/**
 * Verifies a JWT token.
 *
 * @param {string} token - JWT token string.
 * @returns {{
 *   success: boolean,
 *   message: string,
 *   payload?: object
 * }}
 */
const verifyToken = (token) => {
  if (!process.env.JWT_SECRET) {
    console.error("❌ JWT_SECRET is missing in environment variables.");
    return {
      success: false,
      message: "Internal server error. Please contact support.",
    };
  }

  if (!token) {
    console.warn("⚠️ No token provided for verification.");
    return {
      success: false,
      message: "Authentication token is required.",
    };
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // console.log("✅ Token verified successfully:", decoded);
    return {
      success: true,
      message: "Token is valid.",
      payload: decoded,
    };
  } catch (error) {
    let message = "Token verification failed.";
    if (error.name === "TokenExpiredError") {
      message = "Token has expired.";
    } else if (error.name === "JsonWebTokenError") {
      message = "Token is invalid.";
    }

    console.error(`❌ JWT Error: ${message}`, error);

    return {
      success: false,
      message,
    };
  }
};

module.exports = {
  createToken,
  verifyToken,
  // ⬇️ You can add more helpers like refreshToken, decodeToken, blacklistToken etc. here in the future
};

const DEBUG = process.env.DEBUG === "true";

const openParam = async (req, res, next) => {
  try {
    if (DEBUG) {
      console.log("🔍 [DEBUG] openParam middleware triggered");
      console.log("Request path:", req.path);
      console.log("Request method:", req.method);
    }

    req.source = "open";

    if (DEBUG) {
      console.log("Assigned req.source:", req.source);
    }

    next();
  } catch (error) {
    console.error("❌ Auth middleware exception:", error);
    return res.status(500).json({
      message:
        "Something went wrong during authentication. Please try again.",
    });
  }
};

module.exports = openParam;

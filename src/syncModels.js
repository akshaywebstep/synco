const { sequelize } = require("./config/db");
require("./models"); // register models & associations

(async () => {
  try {
    await sequelize.query("SET FOREIGN_KEY_CHECKS = 0");
    await sequelize.sync({ force: true });
    await sequelize.query("SET FOREIGN_KEY_CHECKS = 1");

    console.log("✅ All models synchronized successfully!");
    process.exit(0);
  } catch (err) {
    console.error("❌ Failed to sync models:", err);
    process.exit(1);
  }
})();

const cron = require("node-cron");
const {
  autoUpdateSessionStatusByDate,
} = require("../services/admin/classSchedule/classSchedule");

// 🕒 Every day at 12:05 AM UTC
cron.schedule(
  "5 0 * * *", // Minute 5, Hour 0
  async () => {
    try {
      console.log("⏰ CRON Running:", new Date().toISOString());
      await autoUpdateSessionStatusByDate();
      console.log("✅ CRON Completed Successfully");
    } catch (error) {
      console.error("❌ CRON FAILED:", error.message);
    }
  },
  { timezone: "UTC" }
);

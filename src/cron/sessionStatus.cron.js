const cron = require("node-cron");
const {
  autoUpdateSessionStatusByDate,
} = require("../services/admin/classSchedule/classSchedule");

// 🕒 Every day at 12:05 AM
cron.schedule("* * * * *", async () => {
  console.log("⏰ CRON: Auto-updating session statuses...");
  await autoUpdateSessionStatusByDate();
});

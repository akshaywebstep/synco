const cron = require("node-cron");
const {
  autoUpdateSessionStatusByDate,
} = require("../services/admin/classSchedule/classSchedule");

// 🕒 Every day at 12:05 AM abc
cron.schedule(
  "* * * * *", // 00:05 UTC
  async () => {
    // console.log("⏰ CRON UTC:", new Date().toISOString());
    await autoUpdateSessionStatusByDate();
  },
  { timezone: "UTC" }
);

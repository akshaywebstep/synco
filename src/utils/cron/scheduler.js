const cron = require("node-cron");
const { reactivateFrozenBookingsCron } = require("./reactivateFrozenBookings");

// This runs every day at midnight
// cron.schedule("0 0 * * *", async () => {
//   await reactivateFrozenBookingsCron();
// });
cron.schedule("*/1 * * * *", async () => {
  console.log("🔄 Running frozen booking reactivation test...");
  await reactivateFrozenBookingsCron();
});
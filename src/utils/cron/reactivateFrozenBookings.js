const { FreezeBooking } = require("../../models");
const { Op } = require("sequelize");
const { reactivateBooking } = require("../../services/admin/booking/freezeBooking");

const DEBUG = process.env.DEBUG === "true";

exports.reactivateFrozenBookingsCron = async () => {
    try {

        if (DEBUG) {
            console.log("⏰ Running frozen booking reactivation cron...");
        }

        const today = new Date();

        const freezes = await FreezeBooking.findAll({
            where: {
                reactivateOn: {
                    [Op.lte]: today
                }
            }
        });

        if (!freezes.length) {
            if (DEBUG) console.log("✅ No frozen bookings to reactivate.");
            return;
        }

        for (const freeze of freezes) {

            if (DEBUG) {
                console.log(`🔄 Reactivating booking: ${freeze.bookingId}`);
            }

            const result = await reactivateBooking(
                freeze.bookingId,
                freeze.reactivateOn,
                "Automatic reactivation after freeze period"
            );

            if (!result.status) {
                console.error(`❌ Failed to reactivate booking ${freeze.bookingId}:`, result.message);
            } else {
                console.log(`✅ Booking ${freeze.bookingId} reactivated successfully`);
                if (DEBUG) {
                    console.log(`   ➤ Status set to 'active'`);
                    console.log(`   ➤ Payment status updated`);
                }
            }
        }

    } catch (error) {
        console.error("❌ Frozen booking cron failed:", error);
    }
};
const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../../config/db");

const HolidayBookingPayment = sequelize.define(
    "HolidayBookingPayment",
    {
        id: {
            type: DataTypes.BIGINT.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },

        holiday_booking_id: {
            type: DataTypes.BIGINT.UNSIGNED,
            allowNull: false,
            references: {
                model: "holiday_booking",
                key: "id",
            },
            onUpdate: "CASCADE",
            onDelete: "CASCADE",
            comment: "Reference to holiday_booking",
        },

        stripeSessionId: {
            type: DataTypes.STRING,
            allowNull: true,
            comment: "Stripe Checkout Session ID (if used)",
        },

        stripe_payment_intent_id: {
            type: DataTypes.STRING,
            allowNull: true,
            comment: "Stripe PaymentIntent ID",
        },

        base_amount: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: false,
            defaultValue: 0,
            comment: "Base amount before discount",
        },

        discount_amount: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: true,
            defaultValue: 0,
            comment: "Discount value applied to this payment",
        },

        amount: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: false,
            defaultValue: 0,
            comment: "Final payment amount after discount",
        },

        currency: {
            type: DataTypes.STRING(10),
            allowNull: false,
            defaultValue: "usd",
            comment: "Payment currency",
        },

        payment_status: {
            type: DataTypes.ENUM("pending", "paid", "failed", "refunded"),
            allowNull: false,
            defaultValue: "pending",
            comment: "Current payment status",
        },

        payment_date: {
            type: DataTypes.DATE,
            allowNull: true,
            comment: "Timestamp when payment succeeded",
        },

        failure_reason: {
            type: DataTypes.TEXT,
            allowNull: true,
            comment: "Failure message or Stripe error details if payment failed",
        },
    },
    {
        tableName: "holiday_booking_payments",
        timestamps: true,
    }
);

HolidayBookingPayment.associate = (models) => {
    HolidayBookingPayment.belongsTo(models.HolidayBooking, {
        foreignKey: "holidayBookingId",
        as: "holiday_booking",
    });
};

module.exports = HolidayBookingPayment;

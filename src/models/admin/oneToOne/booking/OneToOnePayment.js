const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db");

const OneToOnePayment = sequelize.define(
    "OneToOnePayment",
    {
        id: {
            type: DataTypes.BIGINT.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },

        oneToOneBookingId: {
            type: DataTypes.BIGINT.UNSIGNED,
            allowNull: false,
            references: {
                model: "one_to_one_bookings",
                key: "id",
            },
            onUpdate: "CASCADE",
            onDelete: "CASCADE",
            comment: "Reference to One-to-One Booking",
        },

        // 💳 Stripe details
        stripeSessionId: {
            type: DataTypes.STRING,
            allowNull: true,
            comment: "Stripe Checkout Session ID (if used)",
        },

        stripePaymentIntentId: {
            type: DataTypes.STRING,
            allowNull: true,
            comment: "Stripe PaymentIntent ID",
        },

        // 💰 Payment amounts
        baseAmount: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: false,
            defaultValue: 0,
            comment: "Base amount before discount",
        },

        discountAmount: {
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
            comment: "Payment currency (e.g. usd, gbp, eur)",
        },

        // 🧾 Payment status
        paymentStatus: {
            type: DataTypes.ENUM("pending", "paid", "failed", "refunded"),
            allowNull: false,
            defaultValue: "pending",
            comment: "Current payment status",
        },

        paymentDate: {
            type: DataTypes.DATE,
            allowNull: true,
            comment: "Timestamp when payment succeeded",
        },

        failureReason: {
            type: DataTypes.TEXT,
            allowNull: true,
            comment: "Failure message or Stripe error details if payment failed",
        },
    },
    {
        tableName: "one_to_one_payments",
        timestamps: true,
        underscored: true,
    }
);

// 🧩 Associations (optional, add in model index.js if needed)
OneToOnePayment.associate = (models) => {
    OneToOnePayment.belongsTo(models.OneToOneBooking, {
        foreignKey: "oneToOneBookingId",
        as: "booking",
    });
};

module.exports = OneToOnePayment;

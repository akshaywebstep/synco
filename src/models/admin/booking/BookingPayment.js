const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db");

const BookingPayment = sequelize.define(
  "BookingPayment",
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },

    // FK → booking.id
    bookingId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      references: {
        model: "booking",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },

    // Personal details
    firstName: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    lastName: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    email: {
      type: DataTypes.STRING(150),
      allowNull: false,
    },
    billingAddress: {
      type: DataTypes.TEXT,
      allowNull: false,
    },

    // Card / Payment details
    cardHolderName: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    cv2: {
      type: DataTypes.STRING(10),
      allowNull: true,
    },
    expiryDate: {
      type: DataTypes.STRING(10),
      allowNull: true,
    },
    // Add this inside your BookingPayment.define fields
    paymentType: {
      type: DataTypes.ENUM("rrn", "card"),
      allowNull: false,
      defaultValue: "card", // optional: choose a default if needed
    },

    pan: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },

    // Payment status
    paymentStatus: {
      type: DataTypes.ENUM("pending", "paid", "failed"),
      defaultValue: "pending",
    },
    // Cardless reference ID
    referenceId: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },

    // Additional payment details
    currency: {
      type: DataTypes.STRING(10),
      allowNull: false,
      defaultValue: "GBP",
    },
    merchantRef: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    description: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    commerceType: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    gatewayResponse: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    transactionMeta: {
      type: DataTypes.JSON,
      allowNull: true,
    },

    // New fields to store GoCardless data
    goCardlessCustomer: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    goCardlessBankAccount: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    goCardlessBillingRequest: {
      type: DataTypes.JSON,
      allowNull: true,
    },
  },
  {
    tableName: "booking_payments",
    timestamps: true,
  }
);

module.exports = BookingPayment;

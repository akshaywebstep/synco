const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db");

const BookingPayment = sequelize.define(
  "BookingPayment",
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },

    // FK → booking.id
    bookingId: {
      type: DataTypes.BIGINT.UNSIGNED,
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
      allowNull: true,
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

    price: {
      type: DataTypes.DECIMAL(10, 2), // supports values like 99999999.99
      allowNull: false,
      comment: "Total price charged for the booking",
    },

    account_holder_name: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    // Add this inside your BookingPayment.define fields
    paymentType: {
      type: DataTypes.ENUM(
        "accesspaysuite",
        "card",
        "bank",
        "stripe",
        "instant_bank_pay",
      ),
      allowNull: false,
      defaultValue: "card", // optional: choose a default if needed
    },
    paymentCategory: {
      type: DataTypes.ENUM("starter_pack", "pro_rata", "recurring"),
      allowNull: true, // ✅ nullable for old data
      defaultValue: null,
    },

    account_number: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },
    branch_code: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },

    // Payment status
    paymentStatus: {
      type: DataTypes.ENUM(
        "initiated",
        "processing",
        "pending_submission",
        "requires_action",
        "active",
        "paid",
        "failed",
        "cancelled",
        "contract_created",
      ),
      defaultValue: "pending",
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
    // ✅ NEW APS columns
    contractId: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    directDebitRef: {
      type: DataTypes.STRING(100),
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
    goCardlessMandateId: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },

    goCardlessSubscriptionId: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    goCardlessPaymentId: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
  },
  {
    tableName: "booking_payments",
    timestamps: true,
  },
);

module.exports = BookingPayment;

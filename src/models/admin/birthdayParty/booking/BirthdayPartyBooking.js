// models/BirthdayPartyBooking.js
const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../../config/db");

const BirthdayPartyBooking = sequelize.define(
  "BirthdayPartyBooking",
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },

    leadId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      references: {
        model: "birthday_party_leads", // ✅ fixed table name (snake_case)
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
      comment: "Lead associated with this booking",
    },

    coachId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      references: {
        model: "admins",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
      comment: "Admin (coach) assigned to this booking",
    },

    status: {
      type: DataTypes.ENUM(
        "pending",
        "active",
        "confirmed",
        "cancelled",
        "completed"
      ),
      allowNull: false,
      defaultValue: "pending",
      comment: "Current status of the booking",
    },

    type: {
      type: DataTypes.ENUM("paid", "trial", "cancel"),
      allowNull: false,
      defaultValue: "paid",
      comment: "Type of booking (paid/trial/cancel)",
    },

    address: {
      type: DataTypes.STRING,
      allowNull: false,
      comment: "Full address of the birthday party venue",
    },

    date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
      comment: "Party date",
    },

    time: {
      type: DataTypes.STRING,
      allowNull: false,
      comment: "Start time of the party",
    },

    capacity: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 1,
      comment: "Number of attendees or capacity",
    },

    paymentPlanId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true,
      references: {
        model: "payment_plans",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
      comment: "Linked payment plan (if any)",
    },

    discountId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true,
      references: {
        model: "discounts",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
      comment: "Applied discount (if any)",
    },
     serviceType: {
      type: DataTypes.ENUM(
        "birthday party"
      ),
      allowNull: true, // ✅ allow nulls
      defaultValue: "birthday party", // ✅ default is actually NULL, not 'NULL'
      comment: "Type of service for the booking",
    },
  },
  {
    tableName: "birthday_party_bookings",
    timestamps: true,
  }
);

// ===================================================
// 🧩 Associations
// ===================================================
BirthdayPartyBooking.associate = (models) => {
  // 🔹 A booking belongs to a lead
  BirthdayPartyBooking.belongsTo(models.BirthdayPartyLead, {
    foreignKey: "leadId",
    as: "lead",
  });

  // 🔹 A booking has many students
  BirthdayPartyBooking.hasMany(models.BirthdayPartyStudent, {
    foreignKey: "birthdayPartyBookingId",
    as: "students",
  });

  // 🔹 A booking has one payment record
  BirthdayPartyBooking.hasOne(models.BirthdayPartyPayment, {
    foreignKey: "birthdayPartyBookingId",
    as: "payment",
  });

  // 🔹 A booking belongs to a payment plan
  BirthdayPartyBooking.belongsTo(models.PaymentPlan, {
    foreignKey: "paymentPlanId",
    as: "paymentPlan",
  });

  // 🔹 A booking belongs to a coach/admin
  BirthdayPartyBooking.belongsTo(models.Admin, {
    foreignKey: "coachId",
    as: "coach",
  });

  // 🔹 A booking can have an optional discount
  BirthdayPartyBooking.belongsTo(models.Discount, {
    foreignKey: "discountId",
    as: "discount",
  });
};

module.exports = BirthdayPartyBooking;

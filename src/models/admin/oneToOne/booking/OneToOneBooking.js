const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../../config/db");

const OneToOneBooking = sequelize.define(
  "OneToOneBooking",
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
        model: "oneToOneLeads",
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
      comment: "Admin (coach) assigned for the booking",
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
    },

    type: {
      type: DataTypes.ENUM("paid", "trial", "cancel"),
      allowNull: false,
      defaultValue: "paid",
    },

    location: {
      type: DataTypes.STRING,
      allowNull: false,
      comment: "Venue name or general location",
    },

    address: {
      type: DataTypes.STRING,
      allowNull: false,
      comment: "Full address of the venue",
    },

    date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
      comment: "Session date",
    },

    time: {
      type: DataTypes.STRING,
      allowNull: false,
      comment: "Session start time",
    },

    totalStudents: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 1,
      comment: "Number of students attending",
    },

    areaWorkOn: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "Areas or skills to focus on during session",
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
    },
  },
  {
    tableName: "one_to_one_bookings",
    timestamps: true,
  }
);

OneToOneBooking.associate = (models) => {
  OneToOneBooking.hasMany(models.OneToOneStudent, {
    foreignKey: "oneToOneBookingId",
    as: "students",
  });

  OneToOneBooking.hasOne(models.OneToOnePayment, {
    foreignKey: "oneToOneBookingId",
    as: "payment",
  });

  OneToOneBooking.belongsTo(models.PaymentPlan, {
    foreignKey: "paymentPlanId",
    as: "paymentPlan",
  });

  OneToOneBooking.belongsTo(models.Admin, {
    foreignKey: "coachId",
    as: "coach", // ✅ this alias must match the include alias
  });
};

module.exports = OneToOneBooking;

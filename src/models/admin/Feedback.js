const { DataTypes } = require("sequelize");
const { sequelize } = require("../../config/db");

const Feedback = sequelize.define(
  "Feedback",
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },

    bookingId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true,
      references: {
        model: "booking",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },

    oneToOneBookingId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true,
      references: {
        model: "one_to_one_bookings",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },
     birthdayPartyBookingId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true,
      references: {
        model: "birthday_party_bookings",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },
     holidayBookingId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true,
      references: {
        model: "holiday_booking",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },

    classScheduleId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true,
      references: {
        model: "class_schedules",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },

    venueId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true,
      references: {
        model: "venues",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },
    serviceType: {
      type: DataTypes.ENUM(
        "holiday camp",
        "weekly class membership",
        "weekly class_trial",
        "one to one",
        "birthday party"
      ),
      allowNull: false,
    },

    holidayClassScheduleId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true,
      references: {
        model: "holiday_class_schedules",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },

    holidayVenueId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true,
      references: {
        model: "holiday_venues",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },

    feedbackType: {
      type: DataTypes.ENUM("positive", "negative"),
      allowNull: false,
    },

    category: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },

    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },

    agentAssigned: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true,
      references: {
        model: "admins",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    },

    status: {
      type: DataTypes.ENUM("in_process", "resolved"),
      allowNull: false,
      defaultValue: "in_process",
    },

    createdBy: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      references: {
        model: "admins",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
    },

    deletedBy: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true,
      references: {
        model: "admins",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    },
  },
  {
    tableName: "feedback",
    timestamps: true,
    paranoid: true
  }
);

module.exports = Feedback;

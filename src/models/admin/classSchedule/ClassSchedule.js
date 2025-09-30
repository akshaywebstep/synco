const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db");

const ClassSchedule = sequelize.define(
  "ClassSchedule",
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },

    className: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    capacity: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
    },

    day: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    startTime: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    endTime: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    allowFreeTrial: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },

    facility: {
      type: DataTypes.STRING,
      allowNull: true,
    },

    venueId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      references: {
        model: "venues", // ✅ Table name for Venue
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },
    createdBy: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM("active", "cancelled"),
      allowNull: false,
      defaultValue: "active",
    },
  },
  {
    tableName: "class_schedules",
    timestamps: true,
  }
);

// ✅ Add this association inside the model file
ClassSchedule.associate = function (models) {
  ClassSchedule.belongsTo(models.Venue, {
    foreignKey: "venueId",
    as: "venue",
  });
};

module.exports = ClassSchedule;

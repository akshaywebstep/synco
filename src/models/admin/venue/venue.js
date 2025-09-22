const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db");

const Venue = sequelize.define(
  "Venue",
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },
    area: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    address: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    facility: {
      type: DataTypes.ENUM("Indoor", "Outdoor"),
      allowNull: false,
    },
    parkingNote: {
      type: DataTypes.TEXT,
    },
    howToEnterFacility: {
      type: DataTypes.TEXT,
    },
    // ✅ FK → PaymentPlans.id
    // paymentPlanId: {
    //   type: DataTypes.TEXT("long"), // LONGTEXT in MySQL
    //   allowNull: true,
    //   comment:
    //     "Selected payment plan for paid bookings (stored as text instead of FK)",
    // },

    paymentGroupId: {
      type: DataTypes.TEXT("long"), // LONGTEXT in MySQL
      allowNull: true,
      comment:
        "Selected payment group for paid bookings (stored as text instead of FK)",
    },
    // paymentPlanId: {
    //   type: DataTypes.INTEGER.UNSIGNED,
    //   allowNull: true,
    //   references: {
    //     model: "payment_plans",
    //     key: "id",
    //   },
    //   onDelete: "SET NULL",
    //   onUpdate: "CASCADE",
    // },

    isCongested: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },

    hasParking: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    termGroupId: {
      type: DataTypes.TEXT("long"), // LONGTEXT in MySQL
      allowNull: true,
      comment:
        "Selected term group for paid bookings (stored as text instead of FK)",
    },
    latitude: {
      type: DataTypes.FLOAT,
      allowNull: true,
    },
    longitude: {
      type: DataTypes.FLOAT,
      allowNull: true,
    },
    postal_code: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    createdBy: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
  },
  {
    tableName: "venues",
    timestamps: true,
  }
);

// ✅ Move associations here
Venue.associate = function (models) {
  Venue.hasMany(models.ClassSchedule, {
    foreignKey: "venueId",
    as: "classSchedules",
  });
};

module.exports = Venue;

// Venue.associate = function (models) {
//   Venue.belongsToMany(models.TermGroup, {
//     through: models.Venue,
//     as: "termGroups",
//     foreignKey: "venueId",
//   });

//   // keep the rest

//   // Venue.hasMany(models.ClassSchedule, {
//   //   foreignKey: "venueId",
//   //   as: "classSchedules",
//   // });
// };

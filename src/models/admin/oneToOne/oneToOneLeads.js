// models/OneToOneLead.js
const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db");

const OneToOneLead = sequelize.define(
  "OneToOneLead",
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },

    parentName: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    childName: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    age: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },

    postCode: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },

    packageInterest: {
      type: DataTypes.STRING,
      allowNull: true,
    },

    availability: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: "Parent's availability or preferred contact time",
    },

    source: {
      type: DataTypes.STRING,
      allowNull: true,
      comment:
        "How the lead heard about us (e.g., social media, referral, etc.)",
    },

    status: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: null,
      comment: "Lead status (e.g., referral, contacted, enrolled, etc.)",
    },

    // ✅ Foreign key to admins table for creation
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

    // ✅ Soft delete column
    deletedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },

    // ✅ Foreign key to admins table for deletion
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
    tableName: "one_to_one_leads",
    timestamps: true,
    paranoid: true, // ✅ enables soft deletes
  }
);

// ✅ Associations (if needed)
OneToOneLead.associate = (models) => {
  // Example: Lead created by an admin
  OneToOneLead.belongsTo(models.Admin, {
    foreignKey: "createdBy",
    as: "creator",
  });

  OneToOneLead.belongsTo(models.Admin, {
    foreignKey: "deletedBy",
    as: "deleter",
  });

  OneToOneLead.hasOne(models.OneToOneBooking, {
    foreignKey: "leadId",
    as: "booking",
  });
};

module.exports = OneToOneLead;

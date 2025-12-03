const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../../config/db");

const File = sequelize.define(
  "File",
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },

    folder_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      references: {
        model: "folders",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },

    // File path or uploaded file URL
    uploadFiles: {
      type: DataTypes.JSON,   // IMPORTANT CHANGE
      allowNull: false,
      comment: "Stores array of file URLs",
    },

    // Created by admin
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

    // Soft delete timestamp
    deletedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },

    // Deleted by admin
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
    tableName: "files",
    timestamps: true, // createdAt, updatedAt
    paranoid: true, // enables soft-delete using deletedAt
  }
);

// Associations
File.associate = (models) => {
  File.belongsTo(models.Folder, {
    foreignKey: "folder_id",
    as: "folder",
  });

  File.belongsTo(models.Admin, {
    foreignKey: "createdBy",
    as: "creator",
  });

  File.belongsTo(models.Admin, {
    foreignKey: "deletedBy",
    as: "deleter",
  });
};

module.exports = File;
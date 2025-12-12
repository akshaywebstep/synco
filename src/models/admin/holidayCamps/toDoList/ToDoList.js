const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../../config/db");

const ToDoList = sequelize.define(
  "ToDoList",
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },
    title: {
      type: DataTypes.STRING(200),
      allowNull: false,
      
    },
    comment: {
      type: DataTypes.STRING(200),
      allowNull: true,
      defaultValue:null,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    attachments: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    sortOrder: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,  // ✅ add this
      field: "sort_order",
    },

    createdBy: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      field: "created_by",
      references: {
        model: "admins",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
    },
    assignedAdmins: {
      type: DataTypes.JSON,
      allowNull: false,
      field: "assigned_admins",
    },
    status: {
      type: DataTypes.ENUM("to_do", "in_progress", "in_review", "completed"),
      allowNull: false,
      defaultValue: "to_do",
    },
    priority: {
      type: DataTypes.ENUM("low", "medium", "high"),
      allowNull: false,
      defaultValue: "medium",
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      field: "is_active",
    },
  },
  {
    tableName: "to_do_list",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    paranoid: false,
  }
);

module.exports = ToDoList;

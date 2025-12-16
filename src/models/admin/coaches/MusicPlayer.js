const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db");

const MusicPlayer = sequelize.define(
  "MusicPlayer",
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },

    // ✅ Multiple music files
    uploadMusic: {
      type: DataTypes.STRING, // single file path
      allowNull: false,
      comment: "Uploaded music file path",
    },

    createdBy: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      references: {
        model: "admins",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },

    deletedAt: {
      type: DataTypes.DATE,
      allowNull: true,
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
    tableName: "music_player",
    timestamps: true,
    paranoid: true,
  }
);

module.exports = MusicPlayer;

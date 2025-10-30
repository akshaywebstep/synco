const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/db");

const EmailConfig = sequelize.define(
  "EmailConfig",
  {
    id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true,
    },
    module: {
      type: DataTypes.STRING(191),
      allowNull: false,
    },
    action: {
      type: DataTypes.STRING(191),
      allowNull: false,
    },
    subject: {
      type: DataTypes.STRING(191),
      allowNull: false,
    },
    html_template: {
      type: DataTypes.TEXT("long"),
      allowNull: true,
    },
    smtp_host: {
      type: DataTypes.STRING(191),
      allowNull: false,
    },
    smtp_secure: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
    },
    smtp_port: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
    },
    smtp_username: {
      type: DataTypes.STRING(191),
      allowNull: false,
    },
    smtp_password: {
      type: DataTypes.STRING(191),
      allowNull: false,
    },
    from_email: {
      type: DataTypes.STRING(191),
      allowNull: false,
    },
    from_name: {
      type: DataTypes.STRING(191),
      allowNull: false,
    },
    status: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
    },
    variables: {
      type: DataTypes.TEXT("long"),
      allowNull: true,
      get() {
        const rawValue = this.getDataValue("variables");
        try {
          return JSON.parse(rawValue);
        } catch {
          return null;
        }
      },
      set(value) {
        this.setDataValue("variables", JSON.stringify(value));
      },
    },
    to: {
      type: DataTypes.TEXT("long"),
      allowNull: true,
      get() {
        const rawValue = this.getDataValue("to");
        try {
          return JSON.parse(rawValue);
        } catch {
          return null;
        }
      },
      set(value) {
        this.setDataValue("to", JSON.stringify(value));
      },
    },
    cc: {
      type: DataTypes.TEXT("long"),
      allowNull: true,
      get() {
        const rawValue = this.getDataValue("cc");
        try {
          return JSON.parse(rawValue);
        } catch {
          return null;
        }
      },
      set(value) {
        this.setDataValue("cc", JSON.stringify(value));
      },
    },
    bcc: {
      type: DataTypes.TEXT("long"),
      allowNull: true,
      get() {
        const rawValue = this.getDataValue("bcc");
        try {
          return JSON.parse(rawValue);
        } catch {
          return null;
        }
      },
      set(value) {
        this.setDataValue("bcc", JSON.stringify(value));
      },
    },
  },
  {
    tableName: "email_configs",
    timestamps: true,
  }
);

module.exports = EmailConfig;

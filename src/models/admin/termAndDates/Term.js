// models/Term.js
const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db");

const Term = sequelize.define(
  "Term",
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },

    termName: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    day: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    startDate: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },

    endDate: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },

    // ✅ Store exclusion dates as JSON array
    exclusionDates: {
      type: DataTypes.JSON,
      allowNull: true,
    },

    totalSessions: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
    },

    // ✅ Store all sessions in one JSON field
    sessionsMap: {
      type: DataTypes.JSON,
      allowNull: true,
    },

    // ✅ Foreign key to term_groups
    termGroupId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      references: {
        model: "term_groups",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    },

    // ✅ Foreign key to admins table for creation
    createdBy: {
      type: DataTypes.INTEGER.UNSIGNED,
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
      type: DataTypes.INTEGER.UNSIGNED,
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
    tableName: "terms",
    timestamps: true,
    paranoid: true, // ✅ Enable soft deletes
  }
);

module.exports = Term;

// const { DataTypes } = require("sequelize");
// const { sequelize } = require("../../../config/db");

// const Term = sequelize.define(
//   "Term",
//   {
//     id: {
//       type: DataTypes.INTEGER.UNSIGNED,
//       autoIncrement: true,
//       primaryKey: true,
//     },

//     termName: {
//       type: DataTypes.STRING,
//       allowNull: false,
//     },
//     day: {
//       type: DataTypes.STRING,
//       allowNull: false,
//     },
//     startDate: {
//       type: DataTypes.DATEONLY,
//       allowNull: false,
//     },
//     endDate: {
//       type: DataTypes.DATEONLY,
//       allowNull: false,
//     },

//     // ✅ Store exclusion dates as JSON array
//     exclusionDates: {
//       type: DataTypes.JSON,
//       allowNull: true,
//     },

//     totalSessions: {
//       type: DataTypes.INTEGER.UNSIGNED,
//       allowNull: true,
//     },

//     // ✅ Store all sessions in one JSON field
//     sessionsMap: {
//       type: DataTypes.JSON,
//       allowNull: true,
//     },

//     termGroupId: {
//       type: DataTypes.INTEGER.UNSIGNED,
//       allowNull: true,
//       references: {
//         model: "term_groups",
//         key: "id",
//       },
//     },

//     createdBy: {
//       type: DataTypes.INTEGER.UNSIGNED,
//       allowNull: false,
//     },
//   },
//   {
//     tableName: "terms",
//     timestamps: true,
//   }
// );

// module.exports = Term;

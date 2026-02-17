const { Op, fn, col, literal } = require("sequelize");
const {
  Comment,
  Admin,
//  sequelize
} = require("../../../../models");
const { sequelize } = require("../../../../models");

const sendEmail = require("../../../../utils/email/sendEmail");
const moment = require("moment");
const debug = require("debug")("service:comments");

const DEBUG = process.env.DEBUG === "true";
const emailModel = require("../../../../services/email");
const PANEL = "admin";
exports.addCommentForHolidayCamp = async ({ commentBy = null, comment, commentType = "paid", serviceType = "holiday camp" }) => {
  const transaction = await sequelize.transaction();
  try {
    if (DEBUG) debug("🔍 Starting addCommentForHolidayCamp service...");

    let admin = null;

    // Validate admin if provided
    if (commentBy) {
      admin = await Admin.findByPk(commentBy, { transaction });
      if (!admin) {
        await transaction.rollback();
        if (DEBUG) debug("❌ Admin not found:", commentBy);
        return { status: false, message: "Admin not found." };
      }
      if (DEBUG) debug("✅ Admin validated:", admin.id);
    }

    // Create comment
    const newComment = await Comment.create({ commentBy, comment, commentType, serviceType }, { transaction });
    if (DEBUG) debug("✅ Comment created:", newComment.id);

    await transaction.commit();
    if (DEBUG) debug("🎉 Transaction committed successfully");

    return {
      status: true,
      message: "Comment added successfully.",
      data: { comment: newComment, admin },
    };
  } catch (error) {
    await transaction.rollback();
    if (DEBUG) debug("❌ addCommentForHolidayCamp Error:", error);
    return { status: false, message: error.message };
  }
};
exports.listCommentsForHolidayCamp = async ({ commentType = "paid", serviceType = "holiday camp" }) => {
  try {
    debug("🔍 Starting listCommentsForHolidayCamp service...");

    const comments = await Comment.findAll({
      where: {
        commentType,
        serviceType,
      },
      include: [
        {
          model: Admin,
          as: "bookedByAdmin",
          attributes: ["id", "firstName", "lastName", "email", "roleId", "status", "profile"],
          required: false,
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    return {
      status: true,
      message: "✅ Comments fetched successfully",
      data: comments,
    };
  } catch (error) {
    return { status: false, message: error.message };
  }
};
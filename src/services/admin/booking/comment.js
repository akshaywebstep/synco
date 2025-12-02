const debug = require("debug")("service:comments");
const { sequelize, Comment, Admin } = require("../../../models");
const DEBUG = process.env.DEBUG === "true";

exports.addCommentForFreeTrial = async ({ commentBy = null, comment, commentType = "free", serviceType = "weekly class" }) => {
    const transaction = await sequelize.transaction();
    try {
        if (DEBUG) debug("🔍 Starting addCommentForFreeTrial service...");

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
        if (DEBUG) debug("❌ addCommentForFreeTrial Error:", error);
        return { status: false, message: error.message };
    }
};
exports.listCommentsForFreeTrial = async ({ commentType = "free", serviceType = "weekly class" }) => {
    try {
        debug("🔍 Starting listComments service...");

        const comments = await Comment.findAll({
            where: {
                commentType,
                serviceType,  // ⭐ FILTER BY SERVICETYPE
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

exports.addCommentForMembership = async ({
    commentBy = null,
    comment,
    commentType = "paid",
    serviceType = "weekly class",
}) => {
    const t = await sequelize.transaction();
    try {
        debug("🔍 Starting addComment service...");

        // 🔹 1. (Optional) Validate Admin/User who made the comment
        let admin = null;
        if (commentBy) {
            admin = await Admin.findByPk(commentBy, { transaction: t });
            if (!admin) {
                await t.rollback();
                debug("❌ Admin not found:", commentBy);
                return { status: false, message: "❌ Admin not found." };
            }
            debug("✅ Admin validated:", admin.id);
        }

        // 🔹 2. Create comment record
        const newComment = await Comment.create(
            {
                commentBy,
                comment,
                commentType,
                serviceType,
            },
            { transaction: t }
        );
        debug("✅ Comment created:", newComment.id);

        await t.commit();
        debug("🎉 Transaction committed successfully");

        return {
            status: true,
            message: "✅ Comment added successfully.",
            data: {
                comment: newComment,
                admin,
            },
        };
    } catch (error) {
        await t.rollback();
        debug("❌ addComment Error:", error);
        return { status: false, message: error.message };
    }
};

exports.listCommentsForMembership = async ({ commentType = "paid", serviceType = "weekly class" }) => {
    try {
        debug("🔍 Starting listComments service...");

        const comments = await Comment.findAll({
            where: { commentType },
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

        debug(`✅ Found ${comments.length} comments`);

        return {
            status: true,
            message: "✅ Comments fetched successfully",
            data: comments,
        };
    } catch (error) {
        debug("❌ listComments Error:", error);
        return { status: false, message: error.message };
    }
};

exports.addCommentForWaitingList = async ({
    commentBy = null,
    comment,
    commentType = "waiting list", // default as per model
}) => {
    const t = await sequelize.transaction();
    try {
        debug("🔍 Starting addComment service...");

        // 🔹 1. (Optional) Validate Admin/User who made the comment
        let admin = null;
        if (commentBy) {
            admin = await Admin.findByPk(commentBy, { transaction: t });
            if (!admin) {
                await t.rollback();
                debug("❌ Admin not found:", commentBy);
                return { status: false, message: "❌ Admin not found." };
            }
            debug("✅ Admin validated:", admin.id);
        }

        // 🔹 2. Create comment record
        const newComment = await Comment.create(
            {
                commentBy,
                comment,
                commentType,
            },
            { transaction: t }
        );
        debug("✅ Comment created:", newComment.id);

        await t.commit();
        debug("🎉 Transaction committed successfully");

        return {
            status: true,
            message: "✅ Comment added successfully.",
            data: {
                comment: newComment,
                admin,
            },
        };
    } catch (error) {
        await t.rollback();
        debug("❌ addComment Error:", error);
        return { status: false, message: error.message };
    }
};

exports.listCommentsForWaitingList = async ({ commentType = "waiting list" }) => {
    try {
        debug("🔍 Starting listComments service...");

        const comments = await Comment.findAll({
            where: { commentType },
            include: [
                {
                    model: Admin,
                    as: "bookedByAdmin",
                    attributes: ["id", "firstName", "lastName", "email", "roleId", "status", "profile"],
                    required: false,
                },
            ],

            order: [["createdAt", "ASC"]],
        });

        debug(`✅ Found ${comments.length} comments`);

        return {
            status: true,
            message: "✅ Comments fetched successfully",
            data: comments,
        };
    } catch (error) {
        debug("❌ listComments Error:", error);
        return { status: false, message: error.message };
    }
};

// lit all comments 
exports.listComments = async ({ commentType }) => {
    try {
        debug("🔍 Starting listComments service...");

        const whereCondition = {};
        if (commentType) {
            whereCondition.commentType = commentType; // filter only if provided
        }

        const comments = await Comment.findAll({
            where: whereCondition,
            include: [
                {
                    model: Admin,
                    as: "bookedByAdmin",
                    attributes: ["id", "firstName", "lastName", "email", "roleId", "status", "profile"],
                    required: false,
                },
            ],
            order: [["createdAt", "ASC"]],
        });

        debug(`✅ Found ${comments.length} comments`);

        return {
            status: true,
            message: "✅ Comments fetched successfully",
            data: comments,
        };
    } catch (error) {
        debug("❌ listComments Error:", error);
        return { status: false, message: error.message };
    }
};

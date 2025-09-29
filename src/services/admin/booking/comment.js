const debug = require("debug")("service:comments");
const { sequelize, Comment, Admin } = require("../../../models");

exports.addCommentForFreeTrial = async ({
    commentBy = null,
    comment,
    commentType = "free", // default as per model
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

exports.listCommentsForFreeTrial = async ({ commentType = "free" }) => {
    try {
        debug("🔍 Starting listComments service...");

        const comments = await Comment.findAll({
            where: { commentType },
            include: [
                {
                    model: Admin,
                    as: "bookedByAdmin",
                    attributes: ["id", "firstName", "lastName", "email", "roleId", "status"],
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

exports.addCommentForMembership = async ({
    commentBy = null,
    comment,
    commentType = "paid", // default as per model
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

exports.listCommentsForMembership = async ({ commentType = "paid" }) => {
    try {
        debug("🔍 Starting listComments service...");

        const comments = await Comment.findAll({
            where: { commentType },
            include: [
                {
                    model: Admin,
                    as: "bookedByAdmin",
                    attributes: ["id", "firstName", "lastName", "email", "roleId", "status"],
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
                    attributes: ["id", "firstName", "lastName", "email", "roleId", "status"],
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
                    attributes: ["id", "firstName", "lastName", "email", "roleId", "status"],
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

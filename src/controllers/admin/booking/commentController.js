
const { validateFormData } = require("../../../utils/validateFormData");
const { logActivity } = require("../../../utils/admin/activityLogger");
const { createNotification } = require("../../../utils/admin/notificationHelper");
const CommentService = require("../../../services/admin/booking/comment");

const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "comments";

// ✅ Add Comment for Free Trial
exports.addCommentForFreeTrial = async (req, res) => {
    const payload = req.body;

    if (DEBUG) console.log("🎯 Add Comment Payload:", payload);

    // ✅ Validate request body
    const { isValid, error } = validateFormData(payload, {
        requiredFields: ["comment"], // comment is required
        optionalFields: ["commentType"],
    });

    if (!isValid) {
        await logActivity(req, PANEL, MODULE, "create", error, false);
        if (DEBUG) console.log("❌ Validation failed:", error);
        return res.status(400).json({ status: false, ...error });
    }

    try {
        // ✅ Use authenticated admin ID
        const commentBy = req.admin?.id || null;

        const result = await CommentService.addCommentForFreeTrial({
            commentBy,
            comment: payload.comment,
            commentType: payload.commentType || "free",
        });

        if (!result.status) {
            await logActivity(req, PANEL, MODULE, "create", result, false);
            if (DEBUG) console.log("❌ Comment creation failed:", result.message);
            return res.status(400).json({ status: false, message: result.message });
        }

        // ✅ Log admin activity
        await logActivity(
            req,
            PANEL,
            MODULE,
            "create",
            { message: `Comment added (type: ${payload.commentType || "free"})` },
            true
        );
        if (DEBUG) console.log("📝 Activity logged successfully");

        // ✅ Notify admins
        const createdBy = req.admin?.firstName || "An admin";
        await createNotification(
            req,
            "New Comment",
            `${createdBy} added a comment for book a free trial.`,
            "Admins"
        );
        if (DEBUG) console.log("🔔 Notification created for admins");

        return res.status(201).json({
            status: true,
            message: "✅ Comment added successfully.",
            data: result.data,
        });
    } catch (error) {
        console.error("❌ Error adding comment:", error);

        await logActivity(
            req,
            PANEL,
            MODULE,
            "create",
            { error: error.message },
            false
        );

        return res.status(500).json({ status: false, message: "Server error." });
    }
};

exports.listCommentsForFreeTrial = async (req, res) => {
    try {
        const commentType = req.query.commentType || "free";

        const result = await CommentService.listCommentsForFreeTrial({ commentType });

        if (!result.status) {
            await logActivity(req, PANEL, MODULE, "list", result, false);
            return res.status(400).json({ status: false, message: result.message });
        }

        await logActivity(req, PANEL, MODULE, "list", { message: "Comments listed successfully" }, true);

        return res.status(200).json({
            status: true,
            message: "✅ Comments fetched successfully",
            data: result.data,
        });
    } catch (error) {
        console.error("❌ Error listing comments:", error);

        await logActivity(req, PANEL, MODULE, "list", { error: error.message }, false);

        return res.status(500).json({ status: false, message: "Server error." });
    }
};

exports.addCommentForMembership = async (req, res) => {
    const payload = req.body;

    if (DEBUG) console.log("🎯 Add Comment Payload:", payload);

    // ✅ Validate request body
    const { isValid, error } = validateFormData(payload, {
        requiredFields: ["comment"], // comment is required
        optionalFields: ["commentType"],
    });

    if (!isValid) {
        await logActivity(req, PANEL, MODULE, "create", error, false);
        if (DEBUG) console.log("❌ Validation failed:", error);
        return res.status(400).json({ status: false, ...error });
    }

    try {
        // ✅ Use authenticated admin ID
        const commentBy = req.admin?.id || null;

        const result = await CommentService.addCommentForMembership({
            commentBy,
            comment: payload.comment,
            commentType: payload.commentType || "paid",
        });

        if (!result.status) {
            await logActivity(req, PANEL, MODULE, "create", result, false);
            if (DEBUG) console.log("❌ Comment creation failed:", result.message);
            return res.status(400).json({ status: false, message: result.message });
        }

        // ✅ Log admin activity
        await logActivity(
            req,
            PANEL,
            MODULE,
            "create",
            { message: `Comment added (type: ${payload.commentType || "paid"})` },
            true
        );
        if (DEBUG) console.log("📝 Activity logged successfully");

        // ✅ Notify admins
        const createdBy = req.admin?.firstName || "An admin";
        await createNotification(
            req,
            "New Comment",
            `${createdBy} added a comment for book a membership"}).`,
            "Admins"
        );
        if (DEBUG) console.log("🔔 Notification created for admins");

        return res.status(201).json({
            status: true,
            message: "✅ Comment added successfully.",
            data: result.data,
        });
    } catch (error) {
        console.error("❌ Error adding comment:", error);

        await logActivity(
            req,
            PANEL,
            MODULE,
            "create",
            { error: error.message },
            false
        );

        return res.status(500).json({ status: false, message: "Server error." });
    }
};

exports.listCommentsForMembership = async (req, res) => {
    try {
        const commentType = req.query.commentType || "paid";

        const result = await CommentService.listCommentsForMembership({ commentType });

        if (!result.status) {
            await logActivity(req, PANEL, MODULE, "list", result, false);
            return res.status(400).json({ status: false, message: result.message });
        }

        await logActivity(req, PANEL, MODULE, "list", { message: "Comments listed successfully" }, true);

        return res.status(200).json({
            status: true,
            message: "✅ Comments fetched successfully",
            data: result.data,
        });
    } catch (error) {
        console.error("❌ Error listing comments:", error);

        await logActivity(req, PANEL, MODULE, "list", { error: error.message }, false);

        return res.status(500).json({ status: false, message: "Server error." });
    }
};

exports.addCommentForWaitingList = async (req, res) => {
    const payload = req.body;

    if (DEBUG) console.log("🎯 Add Comment Payload:", payload);

    // ✅ Validate request body
    const { isValid, error } = validateFormData(payload, {
        requiredFields: ["comment"], // comment is required
        optionalFields: ["commentType"],
    });

    if (!isValid) {
        await logActivity(req, PANEL, MODULE, "create", error, false);
        if (DEBUG) console.log("❌ Validation failed:", error);
        return res.status(400).json({ status: false, ...error });
    }

    try {
        // ✅ Use authenticated admin ID
        const commentBy = req.admin?.id || null;

        const result = await CommentService.addCommentForWaitingList({
            commentBy,
            comment: payload.comment,
            commentType: payload.commentType || "waiting list",
        });

        if (!result.status) {
            await logActivity(req, PANEL, MODULE, "create", result, false);
            if (DEBUG) console.log("❌ Comment creation failed:", result.message);
            return res.status(400).json({ status: false, message: result.message });
        }

        // ✅ Log admin activity
        await logActivity(
            req,
            PANEL,
            MODULE,
            "create",
            { message: `Comment added (type: ${payload.commentType || "waiting list"})` },
            true
        );
        if (DEBUG) console.log("📝 Activity logged successfully");

        // ✅ Notify admins
        const createdBy = req.admin?.firstName || "An admin";
        await createNotification(
            req,
            "New Comment",
            `${createdBy} added a comment for waiting list}).`,
            "Admins"
        );
        if (DEBUG) console.log("🔔 Notification created for admins");

        return res.status(201).json({
            status: true,
            message: "✅ Comment added successfully.",
            data: result.data,
        });
    } catch (error) {
        console.error("❌ Error adding comment:", error);

        await logActivity(
            req,
            PANEL,
            MODULE,
            "create",
            { error: error.message },
            false
        );

        return res.status(500).json({ status: false, message: "Server error." });
    }
};

exports.listCommentsForWaitingList = async (req, res) => {
    try {
        const commentType = req.query.commentType || "waiting list";

        const result = await CommentService.listCommentsForWaitingList({ commentType });

        if (!result.status) {
            await logActivity(req, PANEL, MODULE, "list", result, false);
            return res.status(400).json({ status: false, message: result.message });
        }

        await logActivity(req, PANEL, MODULE, "list", { message: "Comments listed successfully" }, true);

        return res.status(200).json({
            status: true,
            message: "✅ Comments fetched successfully",
            data: result.data,
        });
    } catch (error) {
        console.error("❌ Error listing comments:", error);

        await logActivity(req, PANEL, MODULE, "list", { error: error.message }, false);

        return res.status(500).json({ status: false, message: "Server error." });
    }
};

exports.listComments = async (req, res) => {
    try {
        const commentType = req.query.commentType; 

        const result = await CommentService.listComments({ commentType });

        if (!result.status) {
            await logActivity(req, PANEL, MODULE, "list", result, false);
            return res.status(400).json({ status: false, message: result.message });
        }

        await logActivity(req, PANEL, MODULE, "list", { message: "Comments listed successfully" }, true);

        return res.status(200).json({
            status: true,
            message: "✅ Comments fetched successfully",
            data: result.data,
        });
    } catch (error) {
        console.error("❌ Error listing comments:", error);

        await logActivity(req, PANEL, MODULE, "list", { error: error.message }, false);

        return res.status(500).json({ status: false, message: "Server error." });
    }
};

const LeadService = require("../../../services/admin/lead/leads");
const { logActivity } = require("../../../utils/admin/activityLogger");
const {
  createNotification,
} = require("../../../utils/admin/notificationHelper");
const { validateFormData } = require("../../../utils/validateFormData");
const CommentLead = require("../../../services/admin/lead/leads");

const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "leads";

// ✅ Add Comment for lead
exports.addCommentForLead = async (req, res) => {
    const payload = req.body;

    if (DEBUG) console.log("🎯 Add Comment Payload:", payload);

    // ✅ Validate request body
    const { isValid, error } = validateFormData(payload, {
        // requiredFields: ["comment"], // comment is required
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

        const result = await CommentLead.addCommentForLead({
            commentBy,
            comment: payload.comment,
            commentType: payload.commentType || "lead",
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
            { message: `Comment added (type: ${payload.commentType || "lead"})` },
            true
        );
        if (DEBUG) console.log("📝 Activity logged successfully");

        // ✅ Notify admins
        const createdBy = req.admin?.firstName || "An admin";
        await createNotification(
            req,
            "New Comment",
            `${createdBy} added a comment (type: ${payload.commentType || "lead"}).`,
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

exports.listCommentsForLead = async (req, res) => {
    try {
        const commentType = req.query.commentType || "lead";

        const result = await CommentLead.listCommentsForLead({ commentType });

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

exports.createLead = async (req, res) => {
  const { firstName, lastName, email, phone, postcode, childAge, status } =
    req.body;

  if (DEBUG) {
    console.log("📥 Creating new lead:", req.body);
  }

  // ✅ Validation
  const validation = validateFormData(req.body, {
    requiredFields: ["firstName", "lastName", "email", "childAge"],
  });

  if (!validation.isValid) {
    if (DEBUG) console.log("❌ Validation failed:", validation.error);
    await logActivity(req, PANEL, MODULE, "create", validation.error, false);
    return res.status(400).json({ status: false, ...validation });
  }

  try {
    const result = await LeadService.createLead({
      firstName,
      lastName,
      email,
      phone,
      postcode,
      childAge,
      status,
      assignedAgentId: req.admin.id, // ✅ add logged-in admin ID
    });

    if (!result.status) {
      if (DEBUG) console.log("⚠️ Lead creation failed:", result.message);
      await logActivity(req, PANEL, MODULE, "create", result, false);
      return res.status(500).json({ status: false, message: result.message });
    }

    if (DEBUG) console.log("✅ Lead created:", result.data);

    await logActivity(req, PANEL, MODULE, "create", result, true);

    await createNotification(
      req,
      "New Lead Created",
      `Lead "${firstName} ${lastName}" has been added by Admin ID ${req.admin.id}.`, // 👀 include admin info if needed
      "System"
    );

    return res.status(201).json({
      status: true,
      message: "Lead created successfully.",
      data: result.data,
    });
  } catch (error) {
    console.error("❌ Server error during lead creation:", error);
    await logActivity(
      req,
      PANEL,
      MODULE,
      "create",
      { oneLineMessage: error.message },
      false
    );
    return res.status(500).json({ status: false, message: "Server error." });
  }
};

// 
exports.getAllForFacebookLeads = async (req, res) => {
  try {
    if (DEBUG) console.log("📥 Fetching all leads");

    // Extract filters from query parameters
    const filters = {
      name: req.query.name || null,
      venueName: req.query.venueName || null,
      fromDate: req.query.fromDate || null,
      toDate: req.query.toDate || null,
      status: req.query.status || null,
      studentFirstName: req.query.studentFirstName || null,
      studentLastName: req.query.studentLastName || null,
      studentName: req.query.studentName || null,
    };

    // Fetch leads from service
    const result = await LeadService.getAllForFacebookLeads(filters);

    if (!result.status) {
      if (DEBUG) console.log("⚠️ Failed fetching leads:", result.message);

      await logActivity(req, PANEL, MODULE, "read", result, false);

      return res.status(400).json({
        status: false,
        message: result.message,
      });
    }

    if (DEBUG) console.log(`✅ Retrieved ${result.data?.length || 0} leads`);

    await logActivity(
      req,
      PANEL,
      MODULE,
      "read",
      { count: result.data?.length || 0 },
      true
    );

    // Include all leads, even if bookingData or nearestVenues are empty
    const formattedData = (result.data || []).map((lead) => {
      const bookingData = (lead.bookingData || []).filter((b) => b.venue) || [];
      const nearestVenues = lead.nearestVenues || [];
      return { ...lead, bookingData, nearestVenues };
    });

    return res.status(200).json({
      status: true,
      message: "Leads with nearest venues retrieved",
      data: formattedData,
      // allVenues: result.allVenues || [],
      analytics: result.analytics || {},
    });

  } catch (error) {
    console.error("❌ getAllForFacebookLeads Error:", error);

    await logActivity(
      req,
      PANEL,
      MODULE,
      "read",
      { error: error.message },
      false
    );

    return res.status(500).json({
      status: false,
      message: "Server error.",
      error: error.message,
    });
  }
};

exports.getAllReferallLeads = async (req, res) => {
  try {
    if (DEBUG) console.log("📥 Fetching all leads");

    // Extract filters from query parameters
    const filters = {
      name: req.query.name || null,
      venueName: req.query.venueName || null,
      fromDate: req.query.fromDate || null,
      toDate: req.query.toDate || null,
      status: req.query.status || null,
      studentFirstName: req.query.studentFirstName || null,
      studentLastName: req.query.studentLastName || null,
      studentName: req.query.studentName || null,
    };

    // Fetch leads from service
    const result = await LeadService.getAllForFacebookLeads(filters);

    if (!result.status) {
      if (DEBUG) console.log("⚠️ Failed fetching leads:", result.message);

      await logActivity(req, PANEL, MODULE, "read", result, false);

      return res.status(400).json({
        status: false,
        message: result.message,
      });
    }

    if (DEBUG) console.log(`✅ Retrieved ${result.data?.length || 0} leads`);

    await logActivity(
      req,
      PANEL,
      MODULE,
      "read",
      { count: result.data?.length || 0 },
      true
    );

    // Include all leads, even if bookingData or nearestVenues are empty
    const formattedData = (result.data || []).map((lead) => {
      const bookingData = (lead.bookingData || []).filter((b) => b.venue) || [];
      const nearestVenues = lead.nearestVenues || [];
      return { ...lead, bookingData, nearestVenues };
    });

    return res.status(200).json({
      status: true,
      message: "Leads with nearest venues retrieved",
      data: formattedData,
      // allVenues: result.allVenues || [],
      analytics: result.analytics || {},
    });

  } catch (error) {
    console.error("❌ getAllReferallLeads Error:", error);

    await logActivity(
      req,
      PANEL,
      MODULE,
      "read",
      { error: error.message },
      false
    );

    return res.status(500).json({
      status: false,
      message: "Server error.",
      error: error.message,
    });
  }
};

exports.getAllOthersLeads = async (req, res) => {
  try {
    if (DEBUG) console.log("📥 Fetching all leads");

    // Extract filters from query parameters
    const filters = {
      name: req.query.name || null,
      venueName: req.query.venueName || null,
      fromDate: req.query.fromDate || null,
      toDate: req.query.toDate || null,
      status: req.query.status || null,
      studentFirstName: req.query.studentFirstName || null,
      studentLastName: req.query.studentLastName || null,
      studentName: req.query.studentName || null,
    };

    // Fetch leads from service
    const result = await LeadService.getAllOthersLeads(filters);

    if (!result.status) {
      if (DEBUG) console.log("⚠️ Failed fetching leads:", result.message);

      await logActivity(req, PANEL, MODULE, "read", result, false);

      return res.status(400).json({
        status: false,
        message: result.message,
      });
    }

    if (DEBUG) console.log(`✅ Retrieved ${result.data?.length || 0} leads`);

    await logActivity(
      req,
      PANEL,
      MODULE,
      "read",
      { count: result.data?.length || 0 },
      true
    );

    // Include all leads, even if bookingData or nearestVenues are empty
    const formattedData = (result.data || []).map((lead) => {
      const bookingData = (lead.bookingData || []).filter((b) => b.venue) || [];
      const nearestVenues = lead.nearestVenues || [];
      return { ...lead, bookingData, nearestVenues };
    });

    return res.status(200).json({
      status: true,
      message: "Leads with nearest venues retrieved",
      data: formattedData,
      // allVenues: result.allVenues || [],
      analytics: result.analytics || {},
    });

  } catch (error) {
    console.error("❌ getAllReferallLeads Error:", error);

    await logActivity(
      req,
      PANEL,
      MODULE,
      "read",
      { error: error.message },
      false
    );

    return res.status(500).json({
      status: false,
      message: "Server error.",
      error: error.message,
    });
  }
};

exports.getAllLeads = async (req, res) => {
  try {
    if (DEBUG) console.log("📥 Fetching all leads");

    // Extract filters from query parameters
    const filters = {
      name: req.query.name || null,
      venueName: req.query.venueName || null,
      fromDate: req.query.fromDate || null,
      toDate: req.query.toDate || null,
      status: req.query.status || null,
      studentFirstName: req.query.studentFirstName || null,
      studentLastName: req.query.studentLastName || null,
      studentName: req.query.studentName || null,
    };

    // Fetch leads from service
    const result = await LeadService.getAllLeads(filters);

    if (!result.status) {
      if (DEBUG) console.log("⚠️ Failed fetching leads:", result.message);

      await logActivity(req, PANEL, MODULE, "read", result, false);

      return res.status(400).json({
        status: false,
        message: result.message,
      });
    }

    if (DEBUG) console.log(`✅ Retrieved ${result.data?.length || 0} leads`);

    await logActivity(
      req,
      PANEL,
      MODULE,
      "read",
      { count: result.data?.length || 0 },
      true
    );

    // Include all leads, even if bookingData or nearestVenues are empty
    const formattedData = (result.data || []).map((lead) => {
      const bookingData = (lead.bookingData || []).filter((b) => b.venue) || [];
      const nearestVenues = lead.nearestVenues || [];
      return { ...lead, bookingData, nearestVenues };
    });

    return res.status(200).json({
      status: true,
      message: "Leads with nearest venues retrieved",
      data: formattedData,
      // allVenues: result.allVenues || [],
      analytics: result.analytics || {},
    });

  } catch (error) {
    console.error("❌ getAllLeads Error:", error);

    await logActivity(
      req,
      PANEL,
      MODULE,
      "read",
      { error: error.message },
      false
    );

    return res.status(500).json({
      status: false,
      message: "Server error.",
      error: error.message,
    });
  }
};

exports.findAClass = async (req, res) => {
  try {
    if (DEBUG) console.log("📥 Fetching all leads");

    // Extract filters from query parameters
    const filters = {
      name: req.query.name || null,
      venueName: req.query.venueName || null,
      fromDate: req.query.fromDate || null,
      toDate: req.query.toDate || null,
      status: req.query.status || null,
      studentFirstName: req.query.studentFirstName || null,
      studentLastName: req.query.studentLastName || null,
      studentName: req.query.studentName || null,
    };

    // Fetch leads from service
    const result = await LeadService.findAClass(filters);

    if (!result.status) {
      if (DEBUG) console.log("⚠️ Failed fetching leads:", result.message);

      await logActivity(req, PANEL, MODULE, "read", result, false);

      return res.status(400).json({
        status: false,
        message: result.message,
      });
    }

    if (DEBUG) console.log(`✅ Retrieved ${result.data?.length || 0} leads`);

    await logActivity(
      req,
      PANEL,
      MODULE,
      "read",
      { count: result.data?.length || 0 },
      true
    );

    // Only include leads with valid bookingData and nearestVenues
    const formattedData = (result.data || []).map((lead) => {
      const bookingData = (lead.bookingData || []).filter((b) => b.venue) || [];
      const nearestVenues = lead.nearestVenues || [];
      return { ...lead, bookingData, nearestVenues };
    });

    return res.status(200).json({
      status: true,
      message: "Leads with nearest venues retrieved",
      data: formattedData,
      // allVenues: result.allVenues || [],
      analytics: result.analytics || {},
    });

  } catch (error) {
    console.error("❌ findAClass Error:", error);

    await logActivity(
      req,
      PANEL,
      MODULE,
      "read",
      { error: error.message },
      false
    );

    return res.status(500).json({
      status: false,
      message: "Server error.",
      error: error.message,
    });
  }
};
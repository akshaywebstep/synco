const LeadService = require("../../../services/admin/lead/leads");
const { logActivity } = require("../../../utils/admin/activityLogger");
const {
  createNotification,
} = require("../../../utils/admin/notificationHelper");
const { validateFormData } = require("../../../utils/validateFormData");
const CommentLead = require("../../../services/admin/lead/leads");
const sendErrorEmail = require("../../../utils/email/sendErrorEmail");
const { getMainSuperAdminOfAdmin } = require("../../../utils/auth");

const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "leads";

// ✅ Add Comment for lead
exports.addCommentForLead = async (req, res) => {
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
      `${createdBy} added a comment for lead.`,
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

exports.registerFacebookLeads = async (req, res) => {
  try {
    console.log("📥 Facebook Webhook Verification Request:", JSON.stringify(req.query, null, 2));

    const {
      FACEBOOK_VERIFY_TOKEN,
    } = process.env;

    if (!FACEBOOK_VERIFY_TOKEN) {
      console.error("❌ Missing FACEBOOK_VERIFY_TOKEN in .env");
      return res.status(500).json({
        status: false,
        message: "Facebook verify token not configured. Please check .env file.",
      });
    }

    // --- Extract verification parameters from query ---
    const mode = req.query['hub.mode'] || req.query['hub_mode'];
    const token = req.query['hub.verify_token'] || req.query['hub_verify_token'];
    const challenge = req.query['hub.challenge'] || req.query['hub_challenge'];

    if (mode === 'subscribe' && token === FACEBOOK_VERIFY_TOKEN) {
      console.log("✅ Webhook verified successfully.");
      return res.status(200).send(challenge); // Respond with the challenge
    } else {
      console.error(`❌ Webhook verification failed (mode=${mode}, token=${token})`);
      return res.status(403).send("Verification failed.");
    }

  } catch (error) {
    console.error("❌ registerFacebookLeads Error:", error);
    return res.status(500).json({
      status: false,
      message: "An unexpected error occurred during webhook verification.",
      developerMessage: error.message,
      timestamp: new Date().toISOString(),
    });
  }
};

exports.syncFacebookLeads = async (req, res) => {
  try {
    console.log("📥 Facebook Webhook Received:", JSON.stringify(req.body, null, 2));

    const {
      FACEBOOK_PAGE_ACCESS_TOKEN,
      FACEBOOK_GRAPH_API_BASE,
      FACEBOOK_GRAPH_API_VERSION,
    } = process.env;

    if (!FACEBOOK_PAGE_ACCESS_TOKEN) {
      const errMsg = "❌ Missing Facebook Page Access Token in .env";
      console.error(errMsg);
      await sendErrorEmail(`<p>${errMsg}</p>`);
      return res.status(500).json({
        status: false,
        message: "Facebook Page Access Token not configured. Please check .env file.",
      });
    }

    // --- STEP 1: Extract leadgen_id safely ---
    const body = req.body;
    let leadgen_id = null;

    if (body?.entry) {
      for (const entry of body.entry) {
        if (entry.changes) {
          for (const change of entry.changes) {
            if (change.field === "leadgen" && change.value?.leadgen_id) {
              leadgen_id = change.value.leadgen_id;
              break;
            }
          }
        }
      }
    }

    if (!leadgen_id) {
      const warningMsg = "⚠️ No leadgen_id found in webhook payload";
      console.log(warningMsg);
      await sendErrorEmail(`<p>${warningMsg}</p><pre>${JSON.stringify(body, null, 2)}</pre>`);
      return res.status(200).json({ status: false, message: "No lead ID found" });
    }

    console.log("🔗 Lead ID:", leadgen_id);

    // --- STEP 2: Fetch full lead details from Facebook ---
    const leadUrl = `${FACEBOOK_GRAPH_API_BASE}/${FACEBOOK_GRAPH_API_VERSION}/${leadgen_id}`;
    const leadResponse = await axios.get(leadUrl, {
      params: {
        fields: "id,created_time,field_data",
        access_token: FACEBOOK_PAGE_ACCESS_TOKEN,
      },
    });

    const leadData = leadResponse.data;
    console.log("🌐 Facebook Lead Data:", leadData);

    if (!leadData.field_data) {
      const noFieldMsg = "⚠️ No field_data found in Facebook lead response";
      await sendErrorEmail(`<p>${noFieldMsg}</p><pre>${JSON.stringify(leadData, null, 2)}</pre>`);
      return res.status(200).json({ status: false, message: "No field_data found" });
    }

    // --- STEP 3: Parse field_data into usable key-value pairs ---
    const parsedFields = {};
    leadData.field_data.forEach(field => {
      parsedFields[field.name] = Array.isArray(field.values)
        ? field.values.join(", ")
        : field.values || "";
    });

    console.log("✅ Parsed Lead Fields:", parsedFields);

    // --- STEP 4: Create lead automatically ---
    const result = await LeadService.createLead({
      firstName: parsedFields.first_name?.split(" ")[0] || "Unknown",
      lastName: parsedFields.last_name?.split(" ")[1] || "",
      email: parsedFields.email || "no-email@example.com",
      phone: parsedFields.phone_number || "",
      postcode: parsedFields.post_code || "",
      childAge: parsedFields.child_age || 6,
      status: "Facebook"
    });

    if (!result.status) {
      const failMsg = `❌ Lead creation failed: ${result.message}`;
      console.error(failMsg);
      await sendErrorEmail(`<p>${failMsg}</p><pre>${JSON.stringify(parsedFields, null, 2)}</pre>`);
      return res.status(500).json({
        status: false,
        message: "Failed to create lead",
        error: result.message,
      });
    }

    console.log("🎉 Lead created successfully:", result.data);

    // --- STEP 5: Respond success to Facebook ---
    return res.status(200).json({
      status: true,
      message: "Lead received and created successfully",
      leadId: leadgen_id,
      createdLead: result.data,
    });

  } catch (error) {
    console.error("❌ syncFacebookLeads Error:", error);

    const isNetworkError = error.message.includes("network");
    const isAuthError = error.message.includes("token");

    let userMessage = "An unexpected error occurred while syncing leads.";
    if (isNetworkError)
      userMessage = "Network issue while connecting to Facebook. Please try again.";
    if (isAuthError)
      userMessage = "Authentication failed. Please verify your Facebook token.";

    // --- Send error email ---
    const errorHtml = `
      <p>${userMessage}</p>
      <pre>${error.stack || error.message}</pre>
      <p>Webhook payload:</p>
      <pre>${JSON.stringify(req.body, null, 2)}</pre>
    `;
    await sendErrorEmail(errorHtml, "Facebook Leads Webhook Error");

    return res.status(500).json({
      status: false,
      code: 500,
      message: userMessage,
      developerMessage: error.message,
      timestamp: new Date().toISOString(),
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
  const adminId = req.admin?.id;
  try {
    if (DEBUG) console.log("📥 Fetching all leads");
    const mainSuperAdminResult = await getMainSuperAdminOfAdmin(req.admin.id);
    const superAdminId = mainSuperAdminResult?.superAdmin.id ?? null;

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
    const result = await LeadService.getAllOthersLeads(superAdminId, filters);

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
  const adminId = req.admin?.id;
  try {
    if (DEBUG) console.log("📥 Fetching all leads");
    const mainSuperAdminResult = await getMainSuperAdminOfAdmin(req.admin.id);
    const superAdminId = mainSuperAdminResult?.superAdmin.id ?? null;

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
    const result = await LeadService.getAllLeads(superAdminId, filters);

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
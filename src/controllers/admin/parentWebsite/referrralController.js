const { validateFormData } = require("../../../utils/validateFormData");
const referralService = require("../../../services/admin/parentWebsite/referralService");

exports.createReferral = async (req, res) => {
  const formData = req.body;
  const parentId = req.parent?.id; // 🔐 from auth middleware

  if (!parentId) {
    return res.status(401).json({
      status: false,
      message: "Unauthorized access.",
    });
  }

  const validation = validateFormData(formData, {
    requiredFields: ["firstName", "lastName", "email"],
  });

  if (!validation.isValid) {
    return res.status(400).json({
      status: false,
      message: validation.message,
      error: validation.error,
    });
  }

  try {
    // 🔹 Set referrer (logged-in parent/admin)
    const payload = {
      firstName: formData.firstName,
      lastName: formData.lastName,
      email: formData.email,
      phone: formData.phone || null,
      notes: formData.notes || null,
      referredBy: parentId,
    };

    const result = await referralService.createReferral(payload);

    if (!result.status) {
      return res.status(400).json({
        status: false,
        message: result.message,
      });
    }

    return res.status(201).json({
      status: true,
      message: "Referral created successfully.",
      data: result.data,
    });
  } catch (error) {
    console.error("❌ createReferral Error:", error);

    return res.status(500).json({
      status: false,
      message: "Server error while creating referral.",
    });
  }
};

exports.listReferrals = async (req, res) => {
  const parentId = req.parent?.id;
  const { status } = req.query;

  if (!parentId) {
    return res.status(401).json({
      status: false,
      message: "Unauthorized access.",
    });
  }

  try {
    const result = await referralService.listReferrals({
      parentId,
      status,
    });

    if (!result.status) {
      return res.status(400).json({
        status: false,
        message: result.message,
      });
    }

    return res.status(200).json({
      status: true,
      message: result.message,
      data: result.data,
    });
  } catch (error) {
    console.error("❌ listReferrals Controller Error:", error);

    return res.status(500).json({
      status: false,
      message: "Server error while fetching referrals.",
    });
  }
};

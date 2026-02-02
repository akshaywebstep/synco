const referralService = require("../../../services/admin/referal/referalService");

exports.listReferrals = async (req, res) => {
  try {
    const adminId = req.admin?.id; // 🔥 current super admin

    if (!adminId) {
      return res.status(403).json({
        status: false,
        message: "Unauthorized",
      });
    }

    const result = await referralService.listReferrals({
      adminId,
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

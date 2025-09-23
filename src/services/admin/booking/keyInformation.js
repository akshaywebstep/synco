const { KeyInformation } = require("../../../models");

// ✅ Update or delete single KeyInformation
exports.updateKeyInformation = async (keyInfoValue) => {
  try {
    // Fetch existing record (assume only 1 row)
    let record = await KeyInformation.findOne();

    // If input is empty/null → delete existing record
    if (!keyInfoValue || keyInfoValue.trim() === "") {
      if (record) await record.destroy();
      return { status: true, message: "KeyInformation cleared.", data: null };
    }

    // If record exists → update
    if (record) {
      await record.update({ keyInformation: keyInfoValue });
    } else {
      // Else → create new
      record = await KeyInformation.create({ keyInformation: keyInfoValue });
    }

    return { status: true, message: "KeyInformation saved successfully.", data: record.get({ plain: true }) };
  } catch (error) {
    console.error("❌ updateKeyInformation Error:", error);
    return { status: false, message: error.message };
  }
};

// Fetch all KeyInformation (single row or empty)
exports.getAllKeyInformation = async () => {
  try {
    const record = await KeyInformation.findOne(); // since only 1 row expected

    return {
      status: true,
      data: record ? record.get({ plain: true }) : null,
    };
  } catch (error) {
    console.error("❌ getAllKeyInformation Error:", error);
    return { status: false, message: error.message };
  }
};
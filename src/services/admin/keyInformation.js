const { KeyInformation } = require("../../models");
const { JSDOM } = require("jsdom");

// ✅ Create / Update Key Information per service
exports.updateKeyInformation = async ({ serviceType, keyInformation }) => {
  try {
    if (!serviceType) {
      return { status: false, message: "serviceType is required." };
    }

    // If keyInformation missing or empty array → delete record
    if (!Array.isArray(keyInformation) || keyInformation.length === 0) {
      const record = await KeyInformation.findOne({ where: { serviceType } });
      if (record) await record.destroy();

      return {
        status: true,
        message: `Key Information cleared for ${serviceType}.`,
        data: null,
      };
    }

    // Find by serviceType
    let record = await KeyInformation.findOne({
      where: { serviceType },
    });

    if (record) {
      await record.update({ keyInformation });
    } else {
      record = await KeyInformation.create({
        serviceType,
        keyInformation,
      });
    }

    return {
      status: true,
      message: `Key Information saved for ${serviceType}.`,
      data: record.get({ plain: true }),
    };
  } catch (error) {
    console.error("❌ updateKeyInformation Error:", error);
    return { status: false, message: error.message };
  }
};

// ✅ Get all Key Information (all services)
exports.getAllKeyInformation = async () => {
  try {
    const records = await KeyInformation.findAll({
      order: [["serviceType", "ASC"]],
    });

    const parsedData = records.map((r) => {
      const data = r.get({ plain: true });

      // 🔹 original data ko alag key me store kar lo
      data.keyInformationRaw = data.keyInformation;

      if (typeof data.keyInformation === "string") {
        try {
          const dom = new JSDOM(data.keyInformation);
          const items = [
            ...dom.window.document.querySelectorAll("li"),
          ].map((li) => li.textContent.trim());

          // 🔹 parsed data existing key me hi rahe
          data.keyInformation = items;
        } catch (err) {
          console.error("HTML parse failed:", err);
          data.keyInformation = [];
        }
      }

      return data;
    });

    return {
      status: true,
      message: "Key Information fetched successfully.",
      data: parsedData,
    };
  } catch (error) {
    return { status: false, message: error.message };
  }
};

// ✅ Get Key Information by serviceType (Booking / Agent use)
exports.getKeyInformationByServiceType = async (serviceType) => {
  try {
    if (!serviceType) {
      return { status: false, message: "serviceType is required." };
    }

    const record = await KeyInformation.findOne({
      where: { serviceType },
    });

    if (!record) {
      return {
        status: true,
        message: `No Key Information found for ${serviceType}.`,
        data: null,
      };
    }

    const data = record.get({ plain: true });

    // 🔹 original data ko alag key me store karo
    data.keyInformationRaw = data.keyInformation;

    // 🔑 SAME HTML parse logic
    if (typeof data.keyInformation === "string") {
      try {
        const dom = new JSDOM(data.keyInformation);
        const items = [
          ...dom.window.document.querySelectorAll("li"),
        ].map((li) => li.textContent.trim());

        // 🔹 parsed data existing key me
        data.keyInformation = items;
      } catch (err) {
        console.error("HTML parse failed:", err);
        data.keyInformation = [];
      }
    }

    return {
      status: true,
      message: "Key Information fetched successfully.",
      data,
    };
  } catch (error) {
    console.error("❌ getKeyInformationByServiceType Error:", error);
    return { status: false, message: error.message };
  }
};

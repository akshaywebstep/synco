const { validateFormData } = require("../../../utils/validateFormData");
const contactService = require("../../../services/admin/contact/contactUsService");

exports.createContactUs = async (req, res) => {
    const formData = req.body;

    const validation = validateFormData(formData, {
        requiredFields: ["name","email"],
    });

    if (!validation.isValid) {
        return res.status(400).json({
            status: false,
            message: validation.message,
            error: validation.error,
        });
    }

    try {
        // 💾 Save
        const result = await contactService.createContactUs(formData);

        if (!result.status) {
            return res.status(500).json({
                status: false,
                message: result.message,
            });
        }

        return res.status(201).json({
            status: true,
            message: "Contact created successfully.",
            data: result.data.toJSON(),
        });
    } catch (error) {
        console.error("❌ createContactUs Error:", error);

        return res.status(500).json({
            status: false,
            message: "Server error while creating contact.",
        });
    }
};


const { validateFormData } = require("../../../../utils/validateFormData");
const oneToOneBookingService = require("../../../../services/admin/oneToOne/booking/oneToOneBooking");
const { logActivity } = require("../../../../utils/admin/activityLogger");

const {
    createNotification,
} = require("../../../../utils/admin/notificationHelper");

const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "one-to-one-Booking";

// create
exports.createOnetoOneBooking = async (req, res) => {
    try {
        const adminId = req.user?.id || null;
        const formData = req.body;

        if (DEBUG) console.log("📥 Incoming booking data:", JSON.stringify(formData, null, 2));

        // ✅ Step 1: Validate main fields
        const validation = validateFormData(formData, {
            requiredFields: [
                "leadId",
                "coachId",
                "location",
                "address",
                "date",
                "time",
                "totalStudents",
                "areaWorkOn",
            ],
        });

        if (!validation.isValid) {
            if (DEBUG) console.warn("⚠️ Validation failed:", validation.missingFields);
            return res.status(400).json({
                success: false,
                message: "Validation failed",
                errors: validation.missingFields,
            });
        }

        // ✅ Step 2: Validate nested data
        if (!Array.isArray(formData.students) || formData.students.length === 0) {
            return res.status(400).json({
                success: false,
                message: "At least one student is required",
            });
        }

        if (!Array.isArray(formData.parents) || formData.parents.length === 0) {
            return res.status(400).json({
                success: false,
                message: "At least one parent is required",
            });
        }

        if (!formData.emergency) {
            return res.status(400).json({
                success: false,
                message: "Emergency contact details are required",
            });
        }

        // 🧠 Optional: Validate student fields
        for (const [index, student] of formData.students.entries()) {
            const studentValidation = validateFormData(student, {
                requiredFields: ["studentFirstName", "studentLastName", "dateOfBirth"],
            });

            if (!studentValidation.isValid) {
                if (DEBUG)
                    console.warn(`⚠️ Student ${index + 1} validation failed:`, studentValidation.missingFields);

                return res.status(400).json({
                    success: false,
                    message: `Student ${index + 1} validation failed`,
                    errors: studentValidation.missingFields,
                });
            }
        }

        // 🧾 Optional: Validate payment section if provided
        if (formData.payment) {
            const paymentValidation = validateFormData(formData.payment, {
                requiredFields: ["firstName", "lastName", "email", "billingAddress"],
            });

            if (!paymentValidation.isValid) {
                if (DEBUG) console.warn("⚠️ Payment validation failed:", paymentValidation.missingFields);
                return res.status(400).json({
                    success: false,
                    message: "Payment details validation failed",
                    errors: paymentValidation.missingFields,
                });
            }
        }

        // ✅ Step 3: Create booking via service
        const result = await oneToOneBookingService.createOnetoOneBooking(formData);

        if (DEBUG) console.log("✅ Booking created successfully:", result);

        // ✅ Step 4: Log activity
        await logActivity({
            panel: PANEL,
            module: MODULE,
            action: "create",
            message: `Created one-to-one booking for Lead ID ${formData.leadId}`,
            adminId,
            metadata: {
                bookingId: result.bookingId,
                totalStudents: formData.totalStudents,
                amount: result.finalAmount,
            },
        });

        // ✅ Step 5: Notify assigned coach
        await createNotification({
            type: "booking_created",
            title: "New One-to-One Booking Created",
            message: `You have been assigned a new one-to-one booking for Lead ID ${formData.leadId}`,
            senderId: adminId,
            receiverId: formData.coachId,
            panel: PANEL,
            module: MODULE,
            metadata: {
                bookingId: result.bookingId,
            },
        });

        // ✅ Step 6: Send final response
        return res.status(201).json({
            success: true,
            message: "One-to-One booking created successfully",
            data: result,
        });
    } catch (error) {
        if (DEBUG) console.error("❌ Error in createOnetoOneBooking:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to create One-to-One booking",
            error: DEBUG ? error.message : "Internal server error",
        });
    }
};
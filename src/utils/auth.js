const adminModel = require("../services/admin/administration/adminPannel/admin");
/**
 * Generate a masked password hint for display (e.g., Ro****ia)
 * @param {string} password - The raw password string
 * @param {number} visibleStart - Number of visible characters at the start
 * @param {number} visibleEnd - Number of visible characters at the end
 * @returns {string} masked hint (e.g., "Ad****23")
 */
const generatePasswordHint = (password, visibleStart = 2, visibleEnd = 2) => {
    if (typeof password !== 'string') return '';
    const totalLength = password.length;

    // If password is too short to mask
    if (totalLength <= visibleStart + visibleEnd) {
        return '*'.repeat(totalLength); // mask everything
    }

    const start = password.substring(0, visibleStart);
    const end = password.substring(totalLength - visibleEnd);
    const maskedMiddle = '*'.repeat(totalLength - visibleStart - visibleEnd);

    return `${start}${maskedMiddle}${end}`;
};

/**
 * Retrieves the super admin associated with a specific admin ID.
 * Optionally, you can extend this to recursively trace the "main" super admin.
 *
 * @async
 * @param {number|string} adminId - The ID of the admin to look up.
 * @returns {Promise<Object>} Resolves with:
 *  {
 *    status: boolean,
 *    message: string,
 *    data?: object
 *  }
 */
const getMainSuperAdminOfAdmin = async (adminId, includeSuperAdmin = false) => {
    try {
        const numericId = Number(adminId);

        if (!numericId || isNaN(numericId)) {
            return { status: false, message: "Invalid admin ID provided." };
        }

        // 🔁 Recursive function to trace the super admin hierarchy
        const findSuperAdmin = async (id, visited = new Set()) => {
            // Prevent infinite loops (cyclic references)
            if (visited.has(id)) {
                return {
                    status: false,
                    message: "Cyclic admin relationship detected.",
                };
            }
            visited.add(id);

            const adminResult = await adminModel.getAdminById(id);
            if (!adminResult.status || !adminResult.data) {
                return { status: false, message: `Admin with ID ${id} not found.` };
            }

            const admin = adminResult.data;
            const adminRole = admin.role?.role?.toLowerCase() || "";

            // 🟢 Case 1: Current admin is super admin
            if (adminRole === "super admin") {
                const allAdminsResult = await adminModel.getAllAdmins(id, includeSuperAdmin);

                return {
                    status: true,
                    message: "Main super admin found.",
                    superAdmin: {
                        id: admin.id,
                        details: admin,
                    },
                    admins: Array.isArray(allAdminsResult?.data) ? allAdminsResult.data : [],
                };
            }

            // 🟢 Case 2: Admin has an explicitly linked super admin
            if (admin.superAdminId) {
                return await findSuperAdmin(admin.superAdminId, visited);
            }

            // 🟢 Case 3: Admin was created by another admin
            if (admin.createdByAdmin) {
                return await findSuperAdmin(admin.createdByAdmin, visited);
            }

            // 🔴 Case 4: No links found — reached top-level non-super admin
            return {
                status: false,
                message: "Reached top of hierarchy — no super admin found.",
                superAdmin: null,
                admins: [],
            };
        };

        // Start recursive trace
        return await findSuperAdmin(numericId);
    } catch (error) {
        console.error("❌ Error in getMainSuperAdminOfAdmin:", error);
        return {
            status: false,
            message: "An unexpected error occurred while fetching the super admin.",
        };
    }
};

// exports.getChildAdminIds = async (superAdminId) => {
//   if (!superAdminId) return [];

//   const children = await Admin.findAll({
//     where: { parentAdminId: superAdminId }, // adjust field name if your column differs
//     attributes: ['id'],
//     raw: true,
//   });

//   return children.map((c) => c.id);
// };

module.exports = {
    generatePasswordHint,
    getMainSuperAdminOfAdmin,
    // getChildAdminIds,
};

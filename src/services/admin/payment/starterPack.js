const StarterPack = require("../../../models/admin/payment/StarterPack");
const { Admin } = require("../../../models");

// ✅ Create a new starter pack
exports.createStarterPack = async (data) => {
    try {
        const {
            title,
            description,
            price,
            enabled,
            mandatory,
            appliesOnTrialConversion,
            appliesOnDirectMembership,
            createdBy,
        } = data;

        // Optional: check if admin exists
        const admin = await Admin.findByPk(createdBy);
        if (!admin) {
            return {
                status: false,
                message: "Invalid admin ID.",
            };
        }

        const starterPack = await StarterPack.create({
            title,
            description,
            price,
            enabled,
            mandatory,
            appliesOnTrialConversion,
            appliesOnDirectMembership,
            createdBy,
        });

        return {
            status: true,
            data: starterPack,
            message: "Starter pack created successfully.",
        };
    } catch (error) {
        console.error("❌ createStarterPack error:", error.message);
        return {
            status: false,
            message: `Failed to create starter pack. ${error.message}`,
        };
    }
};

// ✅ Get all starter pack for current admin
exports.getAllStarterPack = async (superAdminId, adminId) => {
    try {

        // const currentAdmin = await Admin.findByPk(adminId);

        // let whereCondition = {};

        // // ✅ If superAdminId is null → This is SuperAdmin
        // if (!currentAdmin.superAdminId) {
        //     // get all child admins/franchisee
        //     const childAdmins = await Admin.findAll({
        //         where: { superAdminId: Number(adminId) },
        //         attributes: ["id"],
        //     });

        //     const childIds = childAdmins.map(a => a.id);

        //     childIds.push(Number(adminId)); // include self

        //     whereCondition.createdBy = childIds;
        // }
        // else {
        //     // ✅ Normal Admin / Franchisee → only own data
        //     whereCondition.createdBy = Number(adminId);
        // }

        const starterPack = await StarterPack.findAll({
            // where: whereCondition,
            order: [["createdAt", "DESC"]],
        });

        return {
            status: true,
            data: starterPack,
            message: `${starterPack.length} starter pack found.`,
        };
    } catch (error) {
        return {
            status: false,
            message: `Failed to fetch starter pack. ${error.message}`,
        };
    }
};

// ✅ Get by ID starter pack for current admin
exports.getStarterPackById = async (id, superAdminId, adminId) => {
  try {
    // const currentAdmin = await Admin.findByPk(adminId);

    // if (!currentAdmin) {
    //   return {
    //     status: false,
    //     message: "Admin not found.",
    //   };
    // }

    let whereCondition = {
      id: Number(id),
    };

    // // ✅ If Super Admin (no superAdminId)
    // if (!currentAdmin.superAdminId) {
    //   // Get all child admins
    //   const childAdmins = await Admin.findAll({
    //     where: { superAdminId: Number(adminId) },
    //     attributes: ["id"],
    //   });

    //   const childIds = childAdmins.map((a) => a.id);

    //   childIds.push(Number(adminId)); // include self

    //   whereCondition.createdBy = childIds;
    // } else {
    //   // ✅ Normal Admin / Franchisee → only own data
    //   whereCondition.createdBy = Number(adminId);
    // }

    const starterPack = await StarterPack.findOne({
      where: whereCondition,
    });

    if (!starterPack) {
      return {
        status: false,
        message: "No starter pack found with the provided ID.",
        data: null,
      };
    }

    return {
      status: true,
      data: starterPack,
      message: "Starter pack found successfully.",
    };
  } catch (error) {
    return {
      status: false,
      message: `Failed to fetch starter pack. ${error.message}`,
    };
  }
};


// ✅ Update starter pack
exports.updateStarterPack = async (id, data, superAdminId, adminId) => {
    try {
        // const currentAdmin = await Admin.findByPk(adminId);

        // if (!currentAdmin) {
        //     return {
        //         status: false,
        //         message: "Admin not found.",
        //     };
        // }

        let whereCondition = {
            id: Number(id),
        };

        // ✅ Super Admin
        // if (!currentAdmin.superAdminId) {
        //     const childAdmins = await Admin.findAll({
        //         where: { superAdminId: Number(adminId) },
        //         attributes: ["id"],
        //     });

        //     const childIds = childAdmins.map(a => a.id);
        //     childIds.push(Number(adminId));

        //     whereCondition.createdBy = childIds;
        // } 
        // // ✅ Normal Admin
        // else {
        //     whereCondition.createdBy = Number(adminId);
        // }

        const starterPack = await StarterPack.findOne({
            where: whereCondition,
        });

        if (!starterPack) {
            return {
                status: false,
                message: "Starter pack not found or access denied.",
            };
        }

        await starterPack.update(data);

        return {
            status: true,
            data: starterPack,
            message: "Starter pack updated successfully.",
        };

    } catch (error) {
        return {
            status: false,
            message: `Failed to update starter pack. ${error.message}`,
        };
    }
};

// ✅ Soft delete starter pack
exports.deleteStarterPack = async (id, superAdminId, adminId) => {
    try {
        // const currentAdmin = await Admin.findByPk(adminId);

        // if (!currentAdmin) {
        //     return {
        //         status: false,
        //         message: "Admin not found.",
        //     };
        // }

        let whereCondition = {
            id: Number(id),
        };

        // ✅ Super Admin
        // if (!currentAdmin.superAdminId) {
        //     const childAdmins = await Admin.findAll({
        //         where: { superAdminId: Number(adminId) },
        //         attributes: ["id"],
        //     });

        //     const childIds = childAdmins.map(a => a.id);
        //     childIds.push(Number(adminId));

        //     whereCondition.createdBy = childIds;
        // } 
        // // ✅ Normal Admin
        // else {
        //     whereCondition.createdBy = Number(adminId);
        // }

        const starterPack = await StarterPack.findOne({
            where: whereCondition,
        });

        if (!starterPack) {
            return {
                status: false,
                message: "Starter pack not found or access denied.",
            };
        }

        // ✅ set deletedBy
        starterPack.deletedBy = adminId;
        await starterPack.save();

        // ✅ Soft delete (this automatically sets deletedAt = current timestamp)
        await starterPack.destroy();

        return {
            status: true,
            message: "Starter pack deleted successfully.",
        };

    } catch (error) {
        return {
            status: false,
            message: `Failed to delete starter pack. ${error.message}`,
        };
    }
};




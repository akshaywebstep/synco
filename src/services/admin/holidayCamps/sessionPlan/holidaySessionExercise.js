const { HolidaySessionExercise } = require("../../../../models");
const { Op } = require("sequelize");

// ✅ Duplicate Session Exercise
exports.duplicateHolidaySessionExercise = async (oldExerciseId, createdBy) => {
  try {
    // STEP 1: Fetch old exercise
    const oldExercise = await HolidaySessionExercise.findOne({ where: { id: oldExerciseId } });
    if (!oldExercise) return { status: false, message: "Original exercise not found" };

    const oldData = oldExercise.get({ plain: true });
     const newTitle = `${oldData.title} (copy)`;

    // STEP 2: Create new exercise row (without files yet)
    const newExercise = await HolidaySessionExercise.create({
      // title: oldData.title,
       title: newTitle,
      duration: oldData.duration,
      description: oldData.description,
      imageUrl: [], // files will be handled separately
      createdBy,
    });

    return { status: true, data: newExercise.get({ plain: true }) };
  } catch (error) {
    console.error("❌ Error duplicating exercise:", error);
    return { status: false, message: error.message };
  }
};

// ✅ Create
exports.createHolidaySessionExercise = async (data) => {
  try {
    const exercise = await HolidaySessionExercise.create(data);
    return { status: true, data: exercise.get({ plain: true }) };
  } catch (error) {
    console.error("❌ Error creating exercise:", error);
    return { status: false, message: error.message };
  }
};

// Get All
exports.getAllHolidaySessionExercises = async (adminId) => {
  try {
    if (!adminId || isNaN(Number(adminId))) {
      return {
        status: false,
        message: "No valid parent or super admin found for this request.",
        data: [],
      };
    }
    const exercises = await HolidaySessionExercise.findAll({
      where: { createdBy:  Number(adminId) },
      order: [["createdAt", "DESC"]],
    });

    return { status: true, data: exercises };
  } catch (error) {
    console.error("❌ Error fetching exercises:", error);
    return { status: false, message: error.message };
  }
};

// ✅ Get by ID
exports.getHolidaySessionExerciseById = async (id, adminId) => {
  try {
    if (!adminId || isNaN(Number(adminId))) {
      return {
        status: false,
        message: "No valid parent or super admin found for this request.",
        data: [],
      };
    }
    const exercise = await HolidaySessionExercise.findOne({
      where: { id, createdBy: Number(adminId) },
    });

    if (!exercise) {
      return { status: false, message: "Exercise not found or unauthorized." };
    }

    return { status: true, data: exercise };
  } catch (error) {
    console.error("❌ Error fetching exercise by ID:", error);
    return { status: false, message: error.message };
  }
};

// ✅ Update
exports.updateHolidaySessionExercise = async (id, data, adminId) => {
  try {
    const exercise = await HolidaySessionExercise.findOne({
      where: { id, createdBy: adminId },
    });

    if (!exercise) {
      return { status: false, message: "Exercise not found or unauthorized" };
    }

    await exercise.update(data);
    return { status: true, data: exercise };
  } catch (error) {
    console.error("❌ Error updating exercise:", error);
    return { status: false, message: error.message };
  }
};

// ✅ Delete
exports.deleteHolidaySessionExercise = async (id, adminId) => {
  try {
    // Find the exercise (include only exercises created by this admin)
    const exercise = await HolidaySessionExercise.findOne({
      where: {
        id,
        createdBy: adminId, // only creator can delete
      },
    });

    if (!exercise) {
      return { status: false, message: "Exercise not found or unauthorized" };
    }

    // ✅ Soft delete: set deletedBy before destroy
    await exercise.update({ deletedBy: adminId });

    // ✅ Soft delete row (paranoid: true sets deletedAt)
    await exercise.destroy();

    return { status: true, message: "Exercise deleted successfully" };
  } catch (error) {
    console.error("❌ Error deleting exercise:", error);
    return { status: false, message: error.message };
  }
};

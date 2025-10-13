const { SessionExercise } = require("../../../models");
const { Op } = require("sequelize");

// ✅ Duplicate Session Exercise
exports.duplicateSessionExercise = async (oldExerciseId, createdBy) => {
  try {
    // STEP 1: Fetch old exercise
    const oldExercise = await SessionExercise.findOne({ where: { id: oldExerciseId } });
    if (!oldExercise) return { status: false, message: "Original exercise not found" };

    const oldData = oldExercise.get({ plain: true });

    // STEP 2: Create new exercise row (without files yet)
    const newExercise = await SessionExercise.create({
      title: oldData.title,
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
exports.createSessionExercise = async (data) => {
  try {
    const exercise = await SessionExercise.create(data);
    return { status: true, data: exercise.get({ plain: true }) };
  } catch (error) {
    console.error("❌ Error creating exercise:", error);
    return { status: false, message: error.message };
  }
};

// Get All
exports.getAllSessionExercises = async (adminId) => {
  try {
    const exercises = await SessionExercise.findAll({
      where: { createdBy: adminId },
      order: [["createdAt", "ASC"]],
    });

    return { status: true, data: exercises };
  } catch (error) {
    console.error("❌ Error fetching exercises:", error);
    return { status: false, message: error.message };
  }
};

// ✅ Get by ID
exports.getSessionExerciseById = async (id, adminId) => {
  try {
    const exercise = await SessionExercise.findOne({
      where: { id, createdBy: adminId },
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
exports.updateSessionExercise = async (id, data, adminId) => {
  try {
    const exercise = await SessionExercise.findOne({
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
exports.deleteSessionExercise = async (id, adminId) => {
  try {
    // Find the exercise (include only exercises created by this admin)
    const exercise = await SessionExercise.findOne({
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

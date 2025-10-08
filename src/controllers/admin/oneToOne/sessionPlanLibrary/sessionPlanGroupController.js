const { validateFormData } = require("../../../../utils/validateFormData");
const SessionPlanGroupService = require("../../../../services/admin/sessionPlan/sessionPlanGroup");
const SessionExerciseService = require("../../../../services/admin/sessionPlan/sessionExercise");
const { logActivity } = require("../../../../utils/admin/activityLogger");
// const { getVideoDurationInSeconds } = require("../../../utils/videoHelper");
const { downloadFromFTP, uploadToFTP } = require("../../../../utils/uploadToFTP");

const { getVideoDurationInSeconds, formatDuration, } = require("../../../../utils/videoHelper"); 
const {
  createNotification,
} = require("../../../../utils/admin/notificationHelper");
const { SessionExercise } = require("../../../../models");
const path = require("path");
const { saveFile, deleteFile } = require("../../../../utils/fileHandler");

const fs = require("fs");
const os = require("os");

const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "session-plan-struture";

exports.getAllSessionPlanGroupStructure = async (req, res) => {
  try {
    const createdBy = req.admin?.id || req.user?.id;
    const { orderBy = "sortOrder", order = "ASC" } = req.query;

    const result = await SessionPlanGroupService.getAllSessionPlanGroups({
      orderBy,
      order,
      createdBy,
    });

    if (!result.status) {
      await logActivity(req, PANEL, MODULE, "list", result, false);
      return res.status(500).json({ status: false, message: result.message });
    }

    const { groups, exerciseMap } = result.data;

    const formattedData = groups.map((group) => {
      let parsedLevels = {};
      try {
        parsedLevels =
          typeof group.levels === "string"
            ? JSON.parse(group.levels)
            : group.levels || {};
      } catch {
        parsedLevels = {};
      }

      Object.keys(parsedLevels).forEach((levelKey) => {
        const items = Array.isArray(parsedLevels[levelKey])
          ? parsedLevels[levelKey]
          : [parsedLevels[levelKey]];

        parsedLevels[levelKey] = items.map((item) => ({
          ...item,
          sessionExercises: (item.sessionExerciseId || [])
            .map((id) => exerciseMap[id])
            .filter(Boolean),
        }));
      });

      return {
        ...group,
        levels: parsedLevels,
      };
    });

    await logActivity(
      req,
      PANEL,
      MODULE,
      "list",
      { count: formattedData.length },
      true
    );

    return res.status(200).json({
      status: true,
      message: "Fetched session plan groups with exercises successfully.",
      data: formattedData,
    });
  } catch (error) {
    console.error("❌ Controller Error:", error);
    return res.status(500).json({ status: false, message: "Server error" });
  }
};

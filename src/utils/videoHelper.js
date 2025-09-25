const ffmpeg = require("fluent-ffmpeg");
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");
const ffprobeInstaller = require("@ffprobe-installer/ffprobe");
const fs = require("fs");
const path = require("path");
const axios = require("axios");

ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

const DEBUG = true;

/**
 * Get video duration in seconds for a local file
 * @param {string} filePath
 * @returns {Promise<number>}
 */
const getVideoDurationInSeconds = (filePath) => {
  return new Promise((resolve) => {
    if (!filePath) {
      if (DEBUG) console.warn("No file path provided, returning 0");
      return resolve(0);
    }

    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        if (DEBUG) console.error("ffprobe error:", err.message || err);
        return resolve(0);
      }
      const duration = metadata?.format?.duration || 0;
      resolve(duration);
    });
  });
};

/**
 * Format seconds → { formatted, h, m, s }
 * @param {number} seconds
 */
const formatDuration = (seconds) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  const formatted = `${String(h).padStart(2, "0")}:${String(m).padStart(
    2,
    "0"
  )}:${String(s).padStart(2, "0")}`;

  return { formatted, h, m, s };
};

/**
 * Safely get video duration from a remote URL or local file
 * @param {string} videoUrl
 */
const getVideoDurationDetails = async (videoUrl) => {
  let tempFilePath;
  let duration = 0;

  try {
    if (videoUrl.startsWith("http")) {
      // Download remote video temporarily
      tempFilePath = path.join(__dirname, `temp_${Date.now()}.mp4`);
      const writer = fs.createWriteStream(tempFilePath);

      if (DEBUG) console.log("Downloading remote video:", videoUrl);

      const response = await axios({
        url: videoUrl,
        method: "GET",
        responseType: "stream",
      });

      response.data.pipe(writer);

      await new Promise((resolve, reject) => {
        writer.on("finish", resolve);
        writer.on("error", reject);
      });

      duration = await getVideoDurationInSeconds(tempFilePath);

      fs.unlinkSync(tempFilePath); // cleanup
    } else {
      // Local file
      duration = await getVideoDurationInSeconds(videoUrl);
    }
  } catch (error) {
    if (DEBUG) console.error("Error getting video duration:", error);
    duration = 0;
  }

  return formatDuration(duration);
};

module.exports = {
  getVideoDurationInSeconds,
  formatDuration,
  getVideoDurationDetails,
};

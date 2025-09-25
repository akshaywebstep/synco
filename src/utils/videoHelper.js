const ffmpeg = require("fluent-ffmpeg");
const ffprobeStatic = require("ffprobe-static");

const DEBUG = true;

// Set ffprobe path
ffmpeg.setFfprobePath(ffprobeStatic.path);

/**
 * Get video duration in seconds from a URL or local file
 * @param {string} videoUrl
 * @returns {Promise<number>}
 */
const getVideoDurationInSeconds = (videoUrl) => {
  return new Promise((resolve) => {
    if (!videoUrl) return resolve(0);

    if (DEBUG) console.log("Fetching duration for video:", videoUrl);

    ffmpeg.ffprobe(videoUrl, (err, metadata) => {
      if (err) {
        if (DEBUG) console.error("Error getting video duration:", err);
        return resolve(0);
      }
      const duration = metadata.format.duration || 0;
      if (DEBUG) console.log(`Duration for ${videoUrl}: ${duration} seconds`);
      resolve(duration);
    });
  });
};

/**
 * Convert seconds to HH:MM:SS
 */
const formatDuration = (totalSeconds) => {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

module.exports = { getVideoDurationInSeconds, formatDuration, DEBUG };

const { getVideoDurationInSeconds: getDuration } = require("get-video-duration");
const DEBUG = true;

/**
 * Get the duration of a video from its URL or local file in seconds
 * @param {string} videoUrl - The video URL (MP4, etc.)
 * @returns {Promise<number>} Duration in seconds
 */
const getVideoDurationInSeconds = async (videoUrl) => {
  if (!videoUrl) return 0;

  try {
    if (DEBUG) console.log("Fetching duration for video:", videoUrl);
    const duration = await getDuration(videoUrl); // Works for remote and local files
    if (DEBUG) console.log(`Duration for ${videoUrl}: ${duration} seconds`);
    return duration || 0;
  } catch (err) {
    if (DEBUG) console.error("Error getting video duration:", err);
    return 0;
  }
};

/**
 * Convert seconds to HH:MM:SS format
 */
const formatDuration = (totalSeconds) => {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

module.exports = {
  getVideoDurationInSeconds,
  formatDuration,
  DEBUG,
};

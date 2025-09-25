const ffmpeg = require("fluent-ffmpeg");
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");
const ffprobeInstaller = require("@ffprobe-installer/ffprobe");
const axios = require("axios");

ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

const DEBUG = true;

/**
 * Get duration (in seconds) from a local file
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
 * Get duration (in seconds) directly from a remote URL
 * without downloading full file
 */
const getRemoteVideoDuration = async (videoUrl) => {
  return new Promise((resolve) => {
    if (!videoUrl) return resolve(0);

    try {
      ffmpeg.ffprobe(videoUrl, (err, metadata) => {
        if (err) {
          if (DEBUG) console.error("ffprobe remote error:", err.message || err);
          return resolve(0);
        }
        const duration = metadata?.format?.duration || 0;
        resolve(duration);
      });
    } catch (error) {
      if (DEBUG) console.error("Unexpected error:", error);
      resolve(0);
    }
  });
};

/**
 * Format seconds → HH:MM:SS
 */
const formatDuration = (seconds) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  return `${String(h).padStart(2, "0")}:${String(m).padStart(
    2,
    "0"
  )}:${String(s).padStart(2, "0")}`;
};

/**
 * Universal video duration getter
 * Works for both local paths and remote URLs
 */
const getVideoDurationDetails = async (videoUrl) => {
  let duration = 0;

  try {
    if (videoUrl.startsWith("http")) {
      duration = await getRemoteVideoDuration(videoUrl);
    } else {
      duration = await getVideoDurationInSeconds(videoUrl);
    }
  } catch (err) {
    if (DEBUG) console.error("getVideoDurationDetails failed:", err);
    duration = 0;
  }

  return {
    duration,
    formatted: formatDuration(duration),
  };
};

module.exports = {
  getVideoDurationInSeconds,
  getRemoteVideoDuration,
  getVideoDurationDetails,
  formatDuration,
};

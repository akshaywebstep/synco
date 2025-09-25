const ffmpeg = require("fluent-ffmpeg");
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");
const ffprobeInstaller = require("@ffprobe-installer/ffprobe");

ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

const DEBUG = true;

/**
 * Get video duration (in seconds) from a remote video URL
 * @param {string} videoUrl - The full video URL (HTTP/HTTPS)
 * @returns {Promise<number>} - Duration in seconds
 */
const getVideoDurationInSeconds = (videoUrl) => {
  return new Promise((resolve) => {
    if (!videoUrl) {
      if (DEBUG) console.warn("No video URL provided, returning 0");
      return resolve(0);
    }

    if (DEBUG) console.log("Fetching duration for video:", videoUrl);
    console.log(`videoUrl - `, videoUrl);
    ffmpeg.ffprobe(videoUrl, (err, metadata) => {
      if (err) {
        if (DEBUG) console.error("ffprobe error:", err.message || err);
        return resolve(0);
      }

      console.log(`metadata - `, metadata);

      const duration = metadata?.format?.duration || 0;
      if (DEBUG) console.log(`Duration for ${videoUrl}: ${duration} seconds`);
      resolve(duration);
    });
  });
};

module.exports = { getVideoDurationInSeconds, DEBUG };

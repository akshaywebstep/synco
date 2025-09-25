// videoHelper.js
const ffmpeg = require("fluent-ffmpeg");
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");
const ffprobeInstaller = require("@ffprobe-installer/ffprobe");
const { spawn } = require("child_process");
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
 * Get duration (in seconds) from a remote video
 * Streams only the first few MB to ffprobe (avoids crashes on live servers)
 */
const getRemoteVideoDuration = async (videoUrl) => {
  return new Promise(async (resolve) => {
    try {
      // Fetch only the first 5 MB of the file (enough for metadata)
      const response = await axios.get(videoUrl, {
        responseType: "stream",
        headers: { Range: "bytes=0-5000000" },
      });

      const ffprobe = spawn(ffprobeInstaller.path, [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        "pipe:0", // read from stdin
      ]);

      let output = "";
      ffprobe.stdout.on("data", (data) => {
        output += data.toString();
      });

      ffprobe.on("close", () => {
        const duration = parseFloat(output) || 0;
        if (DEBUG) console.log("Remote video duration:", duration);
        resolve(duration);
      });

      ffprobe.on("error", (err) => {
        if (DEBUG) console.error("ffprobe stream error:", err);
        resolve(0);
      });

      // Pipe partial stream into ffprobe
      response.data.pipe(ffprobe.stdin);
    } catch (error) {
      if (DEBUG) console.error("Axios stream error:", error.message || error);
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

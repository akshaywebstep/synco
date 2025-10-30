const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const https = require("https");
const ffmpeg = require("fluent-ffmpeg");
const ffprobeStatic = require("ffprobe-static");
const axios = require("axios");

const DEBUG = true;

// Set ffprobe path
ffmpeg.setFfprobePath(ffprobeStatic.path);

/**
 * Download a remote video URL to a temporary file
 */
const downloadVideo = (videoUrl, tempFilePath) => {
  return new Promise((resolve, reject) => {
    const client = videoUrl.startsWith("https") ? https : http;
    const file = fs.createWriteStream(tempFilePath);

    client
      .get(videoUrl, (res) => {
        res.pipe(file);
        file.on("finish", () => file.close(resolve));
      })
      .on("error", (err) => {
        fs.unlink(tempFilePath, () => {}); // delete temp file on error
        reject(err);
      });
  });
};

/**
 * Get video duration safely (downloads remote file first)
 */
const getVideoDurationInSeconds = async (videoUrl) => {
  if (!videoUrl || typeof videoUrl !== "string" || !videoUrl.trim().startsWith("http")) {
    if (DEBUG) console.warn("⚠️ Skipping invalid video URL:", videoUrl);
    return 0;
  }

  const tempFile = path.join(os.tmpdir(), `${Date.now()}.mp4`);

  try {
    if (DEBUG) console.log("Downloading video to:", tempFile);

    const response = await axios.get(videoUrl.trim(), { responseType: "arraybuffer" });
    fs.writeFileSync(tempFile, response.data);

    const duration = await new Promise((resolve) => {
      ffmpeg.ffprobe(tempFile, (err, metadata) => {
        if (err) {
          if (DEBUG) console.error("ffprobe error:", err);
          return resolve(0);
        }
        resolve(metadata.format.duration || 0);
      });
    });

    if (DEBUG) console.log(`Duration for ${videoUrl}: ${duration} sec`);
    return duration;
  } catch (err) {
    if (DEBUG) console.error("Error getting video duration:", err);
    return 0;
  } finally {
    fs.unlink(tempFile, () => {});
  }
};

const formatDuration = (totalSeconds) => {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);

  let parts = [];

  if (hours > 0) parts.push(`${hours} hour${hours !== 1 ? "s" : ""}`);
  if (minutes > 0) parts.push(`${minutes} minute${minutes !== 1 ? "s" : ""}`);
  if (seconds > 0 || parts.length === 0) {
    parts.push(`${seconds} second${seconds !== 1 ? "s" : ""}`);
  }

  return parts.join(" ");
};

module.exports = { getVideoDurationInSeconds, formatDuration, DEBUG };

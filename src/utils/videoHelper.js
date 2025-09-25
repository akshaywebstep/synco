const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const https = require("https");
const ffmpeg = require("fluent-ffmpeg");
const ffprobeStatic = require("ffprobe-static");

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

    client.get(videoUrl, (res) => {
      res.pipe(file);
      file.on("finish", () => file.close(resolve));
    }).on("error", (err) => {
      fs.unlink(tempFilePath, () => {}); // delete temp file on error
      reject(err);
    });
  });
};

/**
 * Get video duration safely (downloads remote file first)
 */
const getVideoDurationInSeconds = async (videoUrl) => {
  if (!videoUrl) return 0;

  const tempFile = path.join(os.tmpdir(), `${Date.now()}.mp4`);

  try {
    if (DEBUG) console.log("Downloading video to temp file:", tempFile);
    await downloadVideo(videoUrl, tempFile);

    return await new Promise((resolve) => {
      ffmpeg.ffprobe(tempFile, (err, metadata) => {
        fs.unlink(tempFile, () => {}); // clean up temp file

        if (err) {
          if (DEBUG) console.error("ffprobe error:", err);
          return resolve(0);
        }

        const duration = metadata.format.duration || 0;
        if (DEBUG) console.log(`Duration for ${videoUrl}: ${duration} seconds`);
        resolve(duration);
      });
    });
  } catch (err) {
    if (DEBUG) console.error("Download or ffprobe error:", err);
    return 0;
  }
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

const ffmpeg = require("fluent-ffmpeg");
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");
const ffprobeInstaller = require("@ffprobe-installer/ffprobe");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

const DEBUG = true;

const getVideoDurationInSeconds = (videoUrl) => {
  return new Promise(async (resolve) => {
    if (!videoUrl) return resolve(0);
    if (DEBUG) console.log("Fetching duration for video:", videoUrl);

    // First try probing remote URL directly
    ffmpeg.ffprobe(videoUrl, async (err, metadata) => {
      if (err || !metadata?.format?.duration) {
        if (DEBUG) console.error("Direct ffprobe failed, falling back to download:", err?.message);

        try {
          // Download to temp file
          const tempPath = path.join("/tmp", `${Date.now()}.mp4`);
          const writer = fs.createWriteStream(tempPath);
          const response = await axios({ url: videoUrl, method: "GET", responseType: "stream" });
          response.data.pipe(writer);

          writer.on("finish", () => {
            ffmpeg.ffprobe(tempPath, (err2, metadata2) => {
              fs.unlinkSync(tempPath); // cleanup temp file
              if (err2) {
                if (DEBUG) console.error("Error probing downloaded file:", err2);
                return resolve(0);
              }
              const duration = metadata2?.format?.duration || 0;
              if (DEBUG) console.log(`Duration for downloaded file: ${duration} seconds`);
              resolve(duration);
            });
          });
        } catch (downloadErr) {
          if (DEBUG) console.error("Download error:", downloadErr.message);
          return resolve(0);
        }
      } else {
        const duration = metadata?.format?.duration || 0;
        if (DEBUG) console.log(`Duration for ${videoUrl}: ${duration} seconds`);
        resolve(duration);
      }
    });
  });
};

module.exports = { getVideoDurationInSeconds, DEBUG };

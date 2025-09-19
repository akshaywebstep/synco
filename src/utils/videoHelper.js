const ffmpeg = require("fluent-ffmpeg");
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");
const ffprobeInstaller = require("@ffprobe-installer/ffprobe");

ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path); // correct ffprobe

// console.log("ffmpeg path:", ffmpegInstaller.path);
// console.log("ffprobe path:", ffprobeInstaller.path);

const DEBUG = true;

const getVideoDurationInSeconds = (videoUrl) => {
  return new Promise((resolve) => {
    if (!videoUrl) return resolve(0);
    if (DEBUG) console.log("Fetching duration for video:", videoUrl);

    ffmpeg.ffprobe(videoUrl, (err, metadata) => {
      if (err) {
        if (DEBUG) console.error("Error fetching video metadata:", err);
        return resolve(0);
      }
      const duration = metadata?.format?.duration || 0;
      if (DEBUG) console.log(`Duration for ${videoUrl}: ${duration} seconds`);
      resolve(duration);
    });
  });
};

module.exports = { getVideoDurationInSeconds, DEBUG };

const fs = require("fs");
const path = require("path");

function ensureDirectoryExists(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function saveFile(file, destinationPath) {
  return new Promise((resolve, reject) => {
    try {
      ensureDirectoryExists(path.dirname(destinationPath));
      fs.writeFile(destinationPath, file.buffer, (err) => {
        if (err) return reject(err);
        resolve(destinationPath);
      });
    } catch (err) {
      reject(err);
    }
  });
}

function deleteFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (err) {
    console.error("❌ Failed to delete file:", err);
  }
}

module.exports = {
  saveFile,
  deleteFile,
};

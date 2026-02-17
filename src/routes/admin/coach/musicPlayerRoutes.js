const express = require("express");
const router = express.Router();
const multer = require("multer");
const upload = multer(); // ✅ Handles multipart/form-data

const authMiddleware = require("../../../middleware/admin/authenticate");
const permissionMiddleware = require("../../../middleware/admin/permission");

const {
  createUploadMusic,
  getUploadMusic,
  getUploadMusicById,
  renameMusicTrack,
  deleteUploadMusic,
} = require("../../../controllers/admin/coaches/musicPlayerController");

// Route: Upload music (unlimited files)
router.post(
  "/upload",
  authMiddleware,
  upload.fields([
    { name: "uploadMusic", maxCount: 20 },
    { name: "musicImage", maxCount: 1 }
  ]),
  permissionMiddleware("music-player", "upload"),
  createUploadMusic
);

router.get(
  "/list",
  authMiddleware,
  permissionMiddleware("music-player", "view-listing"),
  getUploadMusic
);

router.get(
  "/listBy/:id",
  authMiddleware,
  permissionMiddleware("music-player", "view-listing"),
  getUploadMusicById
);

router.put(
  "/update/:id",
  authMiddleware,
  upload.fields([
    { name: "uploadMusic", maxCount: 20 },
    { name: "musicImage", maxCount: 1 }
  ]),
  permissionMiddleware("music-player", "update"),
  renameMusicTrack
);

router.delete(
  "/delete/:id",
  authMiddleware,
  permissionMiddleware("music-player", "delete"),
  deleteUploadMusic
);

module.exports = router;

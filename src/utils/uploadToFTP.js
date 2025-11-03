// const ftp = require("basic-ftp");
// const Client = ftp.Client;

// const DEBUG = process.env.DEBUG === "true"; // enable logs only if explicitly set

// const ftpConfig = {
//   host: process.env.FTP_HOST,
//   user: process.env.FTP_USER,
//   password: process.env.FTP_PASSWORD,
//   secure: false, // try true if server requires FTPS
//   remoteDir: "", // e.g. "uploads"
//   publicUrlBase: process.env.FTP_FILE_HOST || "https://cdn.example.com/uploads",

// };

// async function uploadToFTP(localPath, remoteFileName) {
//   const client = new Client();
//   client.ftp.verbose = DEBUG; // only verbose when debugging

//   try {
//     if (DEBUG) {
//       console.log("🔑 Connecting with config:", {
//         host: ftpConfig.host,
//         user: ftpConfig.user,
//         password: ftpConfig.password ? "[HIDDEN]" : null,
//         secure: ftpConfig.secure,
//       });
//     }

//     // Connect
//     await client.access({
//       host: ftpConfig.host,
//       user: ftpConfig.user,
//       password: ftpConfig.password,
//       secure: ftpConfig.secure || false,
//     });

//     // Extract relative path inside uploads/
//     const relativePath =
//       localPath.split(/uploads[\\/]/)[1]?.replace(/\\/g, "/") || "";

//     // Get directory path (exclude filename)
//     const dirPath = relativePath
//       .replace(new RegExp(`${remoteFileName}$`), "")
//       .replace(/\/+$/, "");

//     // Start from root
//     await client.cd("/");

//     // Go into base remoteDir (if set)
//     if (ftpConfig.remoteDir) {
//       const baseFolders = ftpConfig.remoteDir.split("/").filter(Boolean);
//       for (const folder of baseFolders) {
//         try {
//           await client.cd(folder);
//         } catch {
//           if (DEBUG) console.log(`📁 Creating missing folder: ${folder}`);
//           await client.send(`MKD ${folder}`);
//           await client.cd(folder);
//         }
//       }
//     }

//     // Ensure subdirectories exist
//     const dirParts = dirPath.split("/").filter(Boolean);
//     for (const folder of dirParts) {
//       try {
//         await client.cd(folder);
//       } catch {
//         if (DEBUG) console.log(`📁 Creating missing subfolder: ${folder}`);
//         await client.send(`MKD ${folder}`);
//         await client.cd(folder);
//       }
//     }

//     // Upload
//     if (DEBUG) console.log(`⬆️ Uploading file: ${localPath} → ${remoteFileName}`);
//     await client.uploadFrom(localPath, remoteFileName);

//     // Close connection
//     await client.close();

//     // Build public URL
//     const publicUrl = `${ftpConfig.publicUrlBase}/${dirPath ? dirPath + "/" : ""
//       }${remoteFileName}`;
//     if (DEBUG) console.log("🌍 Public URL generated:", publicUrl);

//     return publicUrl;
//   } catch (err) {
//     if (DEBUG) {
//       console.error("❌ FTP upload failed:", err.message);
//       console.error("📌 Full error:", err);
//     }
//     try {
//       await client.close();
//     } catch {
//       if (DEBUG) console.warn("⚠️ Failed to close FTP client gracefully");
//     }
//     return null;
//   }
// }

// module.exports = uploadToFTP;
const ftp = require("basic-ftp");
const fs = require("fs");
const path = require("path");
const { AppConfig } = require("../models"); // adjust path if needed

const DEBUG = process.env.DEBUG === "true";

/**
 * Load FTP configuration from AppConfig
 */
async function getFTPConfig() {
    const keys = ["FTP_HOST", "FTP_USER", "FTP_PASSWORD", "FTP_FILE_HOST"];
    const configs = await AppConfig.findAll({ where: { key: keys } });

    const configMap = {};
    for (const c of configs) configMap[c.key] = c.value;

    if (!configMap.FTP_HOST || !configMap.FTP_USER || !configMap.FTP_PASSWORD) {
        throw new Error("Missing FTP configuration in AppConfig.");
    }

    return {
        host: configMap.FTP_HOST,
        user: configMap.FTP_USER,
        password: configMap.FTP_PASSWORD,
        secure: false,
        publicUrlBase:
            configMap.FTP_FILE_HOST || "https://webstepdev.com/demo/syncoUploads",
    };
}

// -------------------- Upload --------------------
async function uploadToFTP(localPath, remoteFilePath) {
    const client = new ftp.Client();
    client.ftp.verbose = DEBUG;

    try {
        const ftpConfig = await getFTPConfig();

        if (DEBUG) console.log("🔑 Connecting to FTP for upload...");
        await client.access({
            host: ftpConfig.host,
            user: ftpConfig.user,
            password: ftpConfig.password,
            secure: ftpConfig.secure || false,
        });

        // Split remote path into folders + filename
        const folders = path.posix.dirname(remoteFilePath).split("/").filter(Boolean);
        const fileName = path.posix.basename(remoteFilePath);

        // Ensure remote directories exist
        await client.cd("/"); // start from root
        for (const folder of folders) {
            try {
                await client.cd(folder);
            } catch {
                await client.send(`MKD ${folder}`);
                await client.cd(folder);
            }
        }

        if (DEBUG)
            console.log(`⬆️ Uploading: ${localPath} → ${remoteFilePath}`);
        await client.uploadFrom(localPath, fileName);

        await client.close();

        const publicUrl = `${ftpConfig.publicUrlBase}/${folders.join("/")}/${fileName}`;
        if (DEBUG) console.log("🌍 Public URL:", publicUrl);
        return publicUrl.replace(/\\/g, "/");
    } catch (err) {
        console.error("❌ FTP upload failed:", err);
        try {
            await client.close();
        } catch { }
        return null;
    }
}

// -------------------- Download --------------------
async function downloadFromFTP(fileUrl, localPath) {
    if (!fileUrl) return null;

    const client = new ftp.Client();
    client.ftp.verbose = DEBUG;

    try {
        const ftpConfig = await getFTPConfig();

        if (DEBUG) console.log("🔑 Connecting to FTP for download...");
        await client.access({
            host: ftpConfig.host,
            user: ftpConfig.user,
            password: ftpConfig.password,
            secure: ftpConfig.secure || false,
        });

        let urlPath = fileUrl.replace(ftpConfig.publicUrlBase, "").replace(/^\/+/, "");
        urlPath = `/${urlPath}`;

        // Ensure local directory exists
        const dir = path.dirname(localPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        if (DEBUG) console.log(`⬇️ Downloading: ${urlPath} → ${localPath}`);
        await client.downloadTo(localPath, urlPath);

        return localPath;
    } catch (err) {
        console.error("❌ FTP download failed:", err);
        throw err;
    } finally {
        client.close();
    }
}

module.exports = { uploadToFTP, downloadFromFTP };

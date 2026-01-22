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
    // client.ftp.verbose = DEBUG;

    try {
        const ftpConfig = await getFTPConfig();

        // if (DEBUG) console.log("🔑 Connecting to FTP for upload...");
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
                await client.cd(folder);      // folder exists
            } catch {
                await client.send(`MKD ${folder}`); // create folder
                await client.cd(folder);            // then enter it
            }
        }

        // if (DEBUG)
        //     console.log(`⬆️ Uploading: ${localPath} → ${remoteFilePath}`);
        await client.uploadFrom(localPath, fileName);

        await client.close();

        const publicUrl = `${ftpConfig.publicUrlBase}/${folders.join("/")}/${fileName}`;
        // if (DEBUG) console.log("🌍 Public URL:", publicUrl);
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
    // client.ftp.verbose = DEBUG;

    try {
        const ftpConfig = await getFTPConfig();

        // if (DEBUG) console.log("🔑 Connecting to FTP for download...");
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

        // if (DEBUG) console.log(`⬇️ Downloading: ${urlPath} → ${localPath}`);
        await client.downloadTo(localPath, urlPath);

        return localPath;
    } catch (err) {
        console.error("❌ FTP download failed:", err);
        throw err;
    } finally {
        client.close();
    }
}

/* DELETE FILE */
async function deleteFromFTP(fileUrl) {
    const client = new ftp.Client();
    // client.ftp.verbose = DEBUG;

    try {
        const ftpConfig = await getFTPConfig();

        let remotePath = fileUrl.replace(ftpConfig.publicUrlBase, "").replace(/^\/+/, "");
        remotePath = `/${remotePath}`;

        await client.access({
            host: ftpConfig.host,
            user: ftpConfig.user,
            password: ftpConfig.password,
            secure: false,
        });

        await client.remove(remotePath);
        await client.close();
        return true;
    } catch (err) {
        console.error("❌ FTP delete failed:", err.message);
        try { await client.close(); } catch { }
        throw err;
    }
}

// -------------------- Rename (NO local file) --------------------
// -------------------- Rename (FIXED) --------------------
async function renameOnFTP(fileUrl, newFileName) {
    const client = new ftp.Client();
    // client.ftp.verbose = DEBUG;

    try {
        const ftpConfig = await getFTPConfig();

        await client.access({
            host: ftpConfig.host,
            user: ftpConfig.user,
            password: ftpConfig.password,
            secure: false,
        });

        // OLD FILE PATH
        let oldPath = fileUrl
            .replace(ftpConfig.publicUrlBase, "")
            .replace(/^\/+/, "");

        oldPath = `/${oldPath}`;

        // 🔒 FORCE filename only (THIS FIXES EVERYTHING)
        const cleanFileName = path.posix.basename(newFileName);

        const folderPath = path.posix.dirname(oldPath);
        const newPath = `${folderPath}/${cleanFileName}`;

        // if (DEBUG) {
        //     console.log(`✏️ Renaming on FTP:`);
        //     console.log(`OLD: ${oldPath}`);
        //     console.log(`NEW: ${newPath}`);
        // }

        await client.rename(oldPath, newPath);
        await client.close();

        return `${ftpConfig.publicUrlBase}${newPath}`.replace(/\\/g, "/");
    } catch (err) {
        console.error("❌ FTP rename failed:", err);
        try { await client.close(); } catch {}
        throw err;
    }
}

module.exports = { uploadToFTP, downloadFromFTP, deleteFromFTP,renameOnFTP };

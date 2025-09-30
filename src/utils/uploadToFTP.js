const ftp = require("basic-ftp");
const Client = ftp.Client;

const ftpConfig = {
  host: process.env.FTP_HOST,
  user: process.env.FTP_USER,
  password: process.env.FTP_PASSWORD,
  secure: false, // try true if server requires FTPS
  remoteDir: "", // e.g. "uploads"
  publicUrlBase: process.env.FTP_FILE_HOST || "https://cdn.example.com/uploads",
};

async function uploadToFTP(localPath, remoteFileName) {
  const client = new Client();
  client.ftp.verbose = true; // log all FTP commands/responses
  console.log("🚀 Starting FTP upload...");

  try {
    console.log("🔑 Connecting with config:", {
      host: ftpConfig.host,
      user: ftpConfig.user,
      password: ftpConfig.password ? "[HIDDEN]" : null,
      secure: ftpConfig.secure,
    });

    // Connect
    await client.access({
      host: ftpConfig.host,
      user: ftpConfig.user,
      password: ftpConfig.password,
      secure: ftpConfig.secure || false,
    });
    console.log("✅ Connected to FTP server");

    // Extract relative path inside uploads/
    const relativePath =
      localPath.split(/uploads[\\/]/)[1]?.replace(/\\/g, "/") || "";
    console.log("📂 Relative path:", relativePath);

    // Get directory path (exclude filename)
    const dirPath = relativePath
      .replace(new RegExp(`${remoteFileName}$`), "")
      .replace(/\/+$/, "");
    console.log("📂 Directory path:", dirPath);

    // Start from root
    console.log("📌 Changing directory to root '/' ...");
    await client.cd("/");

    // Go into base remoteDir (if set)
    if (ftpConfig.remoteDir) {
      console.log("📌 Entering base remoteDir:", ftpConfig.remoteDir);
      const baseFolders = ftpConfig.remoteDir.split("/").filter(Boolean);
      for (const folder of baseFolders) {
        console.log(`➡️ Entering/creating base folder: ${folder}`);
        try {
          await client.cd(folder);
        } catch {
          console.log(`📁 Folder not found, creating: ${folder}`);
          await client.send(`MKD ${folder}`);
          await client.cd(folder);
        }
      }
    }

    // Ensure subdirectories exist
    const dirParts = dirPath.split("/").filter(Boolean);
    for (const folder of dirParts) {
      console.log(`➡️ Entering/creating subfolder: ${folder}`);
      try {
        await client.cd(folder);
      } catch {
        console.log(`📁 Subfolder not found, creating: ${folder}`);
        await client.send(`MKD ${folder}`);
        await client.cd(folder);
      }
    }

    // Upload
    console.log(`⬆️ Uploading file: ${localPath} → ${remoteFileName}`);
    await client.uploadFrom(localPath, remoteFileName);
    console.log("✅ File uploaded successfully:", remoteFileName);

    // Close connection
    console.log("🔒 Closing FTP connection...");
    await client.close();
    console.log("✅ FTP connection closed");

    // Build public URL
    const publicUrl = `${ftpConfig.publicUrlBase}/${
      dirPath ? dirPath + "/" : ""
    }${remoteFileName}`;
    console.log("🌍 Public URL generated:", publicUrl);

    return publicUrl;
  } catch (err) {
    console.error("❌ FTP upload failed:", err.message);
    console.error("📌 Full error:", err);
    try {
      await client.close();
    } catch {
      console.warn("⚠️ Failed to close FTP client gracefully");
    }
    return null;
  }
}

module.exports = uploadToFTP;

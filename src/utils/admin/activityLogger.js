const activityLog = require("../../services/admin/activityLog");
const http = require("http");

const DEBUG = process.env.DEBUG === "true";

exports.logActivity = async (req, panel, module, action, data, status) => {
  try {
    if (!req.admin.id) {
      return {
        status: false,
        message: "adminId missing in request. Logging skipped.",
      };
    }

    const ip =
      req.headers["x-forwarded-for"]?.split(",")[0] ||
      req.socket?.remoteAddress ||
      req.connection?.remoteAddress ||
      "Unknown IP";

    // const ip = '139.5.0.94';
    const apiUrl = `http://ip-api.com/json/${ip}?fields=status,message,continent,continentCode,country,countryCode,region,regionName,city,district,zip,lat,lon,timezone,offset,currency,isp,org,as,asname,reverse,mobile,proxy,hosting,query`;

    // Fetch geolocation data from ip-api
    const geoData = await fetchLocationData(apiUrl);
    // Extract user agent details
    const userAgent = req.headers["user-agent"] || "Unknown";
    const { deviceType, browserName, osName } = parseUserAgent(userAgent);

    const log = {
      adminId: req.admin.id,
      panel,
      module,
      action,
      data,
      status,
      method: req.method,
      route: req.originalUrl,
      ip,
      userAgent: userAgent,
      location: {
        latitude: geoData?.lat ?? "N/A",
        longitude: geoData?.lon ?? "N/A",
        city: geoData?.city ?? "N/A",
        region: geoData?.regionName ?? "N/A",
        country: geoData?.country ?? "N/A",
        timezone: geoData?.timezone ?? "N/A",
      },
      ispInfo: {
        isp: geoData?.isp ?? "Unknown",
        organization: geoData?.org ?? "Unknown",
        as: geoData?.as ?? "Unknown",
        proxy: geoData?.proxy ?? false,
      },
      deviceInfo: {
        device_type: deviceType,
        browser_name: browserName,
        os: osName,
      },
    };

    await activityLog.create(log);

    if (DEBUG) console.log("📌 Full Request Log:", log);

    return {
      status: true,
      message: "Activity log saved successfully.",
    };
  } catch (error) {
    console.error("❌ Error logging request:", error.message);

    return {
      status: false,
      message: "Failed to save activity log.",
    };
  }
};

// Helper: Fetch IP location data
async function fetchLocationData(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const json = JSON.parse(data);
            resolve(json.status === "success" ? json : {});
          } catch (e) {
            resolve({});
          }
        });
      })
      .on("error", reject);
  });
}

// Helper: Basic user-agent parsing
function parseUserAgent(ua) {
  let deviceType = /mobile/i.test(ua) ? "Mobile" : "Desktop";
  let browserName = "Unknown";
  let osName = "Unknown";

  if (/chrome/i.test(ua)) browserName = "Chrome";
  else if (/safari/i.test(ua)) browserName = "Safari";
  else if (/firefox/i.test(ua)) browserName = "Firefox";
  else if (/edge/i.test(ua)) browserName = "Edge";
  else if (/msie|trident/i.test(ua)) browserName = "Internet Explorer";

  if (/windows/i.test(ua)) osName = "Windows";
  else if (/mac/i.test(ua)) osName = "macOS";
  else if (/android/i.test(ua)) osName = "Android";
  else if (/linux/i.test(ua)) osName = "Linux";
  else if (/iphone|ipad/i.test(ua)) osName = "iOS";

  return { deviceType, browserName, osName };
}

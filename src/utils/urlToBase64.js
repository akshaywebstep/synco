const axios = require("axios");

const urlToBase64 = async (url) => {
    try {
        // ✅ Encode URL (THIS FIXES YOUR ISSUE)
        const encodedUrl = encodeURI(url);

        const response = await axios.get(encodedUrl, {
            responseType: "arraybuffer",
            timeout: 20000
        });

        const contentType = response.headers["content-type"];
        const base64 = Buffer.from(response.data).toString("base64");

        return `data:${contentType};base64,${base64}`;
    } catch (error) {
        console.error("URL TO BASE64 ERROR:", error.message);
        throw error;
    }
};

module.exports = urlToBase64;

try {
    console.log("Checking stremio-addon-sdk...");
    require("stremio-addon-sdk");
    console.log("✅ stremio-addon-sdk ok");

    console.log("Checking express...");
    require("express");
    console.log("✅ express ok");

    console.log("Checking cors...");
    require("cors");
    console.log("✅ cors ok");

    console.log("Checking axios...");
    require("axios");
    console.log("✅ axios ok");

    console.log("Checking fluent-ffmpeg...");
    require("fluent-ffmpeg");
    console.log("✅ fluent-ffmpeg ok");

    console.log("Checking local HLS proxy...");
    require("./src/services/hls-proxy");
    console.log("✅ HLS proxy ok");

} catch (e) {
    console.error("❌ IMPORT ERROR:", e.message);
    console.error(e.stack);
}

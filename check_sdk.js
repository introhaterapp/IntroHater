try {
    const sdk = require("stremio-addon-sdk");
    console.log("SDK Exports:", Object.keys(sdk));
} catch (e) {
    console.error(e);
}

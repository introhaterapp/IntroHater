require('dotenv').config();
console.log("Loading stremio-addon-sdk...");
try {
    const { addonBuilder, getRouter } = require("stremio-addon-sdk");
    console.log("Loaded stremio-addon-sdk");
} catch (e) {
    console.error("Failed to load stremio-addon-sdk:", e);
}

console.log("Loading skip-service...");
try {
    const skipService = require('./src/services/skip-service');
    console.log("Loaded skip-service");
} catch (e) {
    console.error("Failed to load skip-service:", e);
}

console.log("Loading catalog-service...");
try {
    const catalogService = require('./src/services/catalog');
    console.log("Loaded catalog-service");
} catch (e) {
    console.error("Failed to load catalog-service:", e);
}

console.log("Loading user-service...");
try {
    const userService = require('./src/services/user-service');
    console.log("Loaded user-service");
} catch (e) {
    console.error("Failed to load user-service:", e);
}

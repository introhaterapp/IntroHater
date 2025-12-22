const skipService = require('../src/services/skip-service');

(async () => {
    try {
        console.log("Starting cleanup...");
        await skipService.cleanupDuplicates();
        console.log("Cleanup finished.");
        process.exit(0);
    } catch (e) {
        console.error("Cleanup failed:", e);
        process.exit(1);
    }
})();

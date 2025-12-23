const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const skipService = require('../src/services/skip-service');
const catalogService = require('../src/services/catalog');

async function restore() {
    console.log('[Restore] Starting catalog count restoration...');

    try {
        // 1. Get ALL segments from the source of truth (MongoDB if URI is present)
        const allSkips = await skipService.getAllSegments();
        const skipKeys = Object.keys(allSkips);

        if (skipKeys.length < 100) {
            console.error(`[Restore] Aborting: Source of truth only has ${skipKeys.length} items. This looks truncated.`);
            process.exit(1);
        }

        console.log(`[Restore] Found ${skipKeys.length} episodes with segments. Rebuilding catalog counts...`);

        // 2. Use the existing repairCatalog logic which is designed to rebuild counts from segments
        // We will improve repairCatalog later, but for now we use it as a tool.
        await catalogService.repairCatalog(allSkips);

        console.log('[Restore] Restoration complete!');
        process.exit(0);
    } catch (e) {
        console.error('[Restore] Failed:', e);
        process.exit(1);
    }
}

restore();

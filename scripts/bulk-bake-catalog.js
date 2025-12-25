require('dotenv').config();
const skipService = require('../src/services/skip-service');
const catalogService = require('../src/services/catalog');
const { performance } = require('perf_hooks');

async function bulkBake() {
    console.log("Starting Bulk Bake of segments into Catalog...");
    const start = performance.now();

    try {
        const allSkips = await skipService.getAllSegments();
        const imdbIds = new Set();

        for (const fullId in allSkips) {
            imdbIds.add(fullId.split(':')[0]);
        }

        console.log(`Found ${imdbIds.size} shows to bake.`);

        let count = 0;
        for (const imdbId of imdbIds) {
            const tShow = performance.now();
            // getSegments handles the merging and series-level logic
            const segments = await skipService.getSegments(imdbId);

            // To bake, we need it grouped by episode
            const segmentsByEp = {};
            segments.forEach(seg => {
                const parts = seg.videoId.split(':');
                if (parts.length >= 3) {
                    const epKey = `${parts[1]}:${parts[2]}`;
                    if (!segmentsByEp[epKey]) segmentsByEp[epKey] = [];
                    segmentsByEp[epKey].push(seg);
                }
            });

            if (Object.keys(segmentsByEp).length > 0) {
                await catalogService.bakeShowSegments(imdbId, segmentsByEp);
                count++;
                if (count % 10 === 0) {
                    console.log(`Baked ${count}/${imdbIds.size} shows...`);
                }
            }
        }

        console.log(`\nBulk Bake Complete! Baked ${count} shows in ${((performance.now() - start) / 1000).toFixed(2)}s`);

    } catch (e) {
        console.error("Bulk Bake Failed:", e);
    }
    process.exit();
}

bulkBake();

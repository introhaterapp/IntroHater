require('dotenv').config();
const path = require('path');
// Fix path: relative to THIS file
const skipService = require('../src/services/skip-service');
const { performance } = require('perf_hooks');

async function profileGetSegments() {
    const seriesId = 'tt0388629'; // One Piece

    console.log(`Profiling getSegments for ${seriesId}...`);

    // 1. Initial State
    const startTime = performance.now();

    // 2. Call the service
    // Note: I can't easily add internal logs without modifying the source, 
    // but I can see the total time first.
    const segments = await skipService.getSegments(seriesId);

    const totalTime = performance.now() - startTime;
    console.log(`\nResult: Found ${segments.length} segments`);
    console.log(`Total Time: ${totalTime.toFixed(2)}ms`);

    if (totalTime > 10000) {
        console.log("\nWARNING: Latency is over 10 seconds. This is definitely a bottleneck.");
    }

    process.exit();
}

profileGetSegments();

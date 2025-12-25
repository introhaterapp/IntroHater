require('dotenv').config();
const skipService = require('../src/services/skip-service');
const { performance } = require('perf_hooks');

async function compareProfiles() {
    console.log("Warm-up (First call to init everything)...");
    await skipService.getSegments('ttNONEXISTENT');

    console.log("\nProfiling NON-EXISTENT show (0 segments)...");
    const t1 = performance.now();
    await skipService.getSegments('ttNONEXISTENT');
    console.log(`0 segments took: ${(performance.now() - t1).toFixed(2)}ms`);

    console.log("\nProfiling ONE PIECE (1038 segments)...");
    const t2 = performance.now();
    const segs = await skipService.getSegments('tt0388629');
    console.log(`1038 segments took: ${(performance.now() - t2).toFixed(2)}ms`);

    process.exit();
}

compareProfiles();

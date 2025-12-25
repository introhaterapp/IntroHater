require('dotenv').config();
const catalogService = require('../src/services/catalog');
const skipRepository = require('../src/repositories/skip.repository');

async function debugOnePiece() {
    await skipRepository.ensureInit();

    console.log("--- One Piece Debug (with Caching) ---");
    const imdbId = 'tt0388629';

    // 1. Cold Lookup
    const startCatalog = Date.now();
    const entry = await catalogService.getShowByImdbId(imdbId);
    const endCatalog = Date.now();
    console.log(`Catalog Entry Lookup (Cold): ${endCatalog - startCatalog}ms`);

    // 2. Warm Lookup
    const startWarm = Date.now();
    await catalogService.getShowByImdbId(imdbId);
    const endWarm = Date.now();
    console.log(`Catalog Entry Lookup (Warm): ${endWarm - startWarm}ms`);

    // 3. Third Lookup (Confirm consistency)
    const startThird = Date.now();
    await catalogService.getShowByImdbId(imdbId);
    const endThird = Date.now();
    console.log(`Catalog Entry Lookup (Third): ${endThird - startThird}ms`);

    if (entry) {
        const episodeCount = Object.keys(entry.episodes || {}).length;
        const bakedCount = Object.values(entry.episodes || {}).filter(e => e.segments && e.segments.length > 0).length;
        console.log(`Title: ${entry.title}`);
        console.log(`Total Episodes in Catalog: ${episodeCount}`);
        console.log(`Episodes with BAKE-IN segments: ${bakedCount}`);
    }

    process.exit(0);
}

debugOnePiece();

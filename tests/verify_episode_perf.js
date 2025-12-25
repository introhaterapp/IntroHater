require('dotenv').config();
const skipService = require('../src/services/skip-service');
const catalogService = require('../src/services/catalog');

async function verifyEpisodePerformance() {
    console.log("--- Episode Performance Verification ---");
    const episodeId = 'tt0388629:1:1'; // One Piece Ep 1

    // 1. COLD LOOKUP (First time, hits DB)
    const startCold = Date.now();
    const seg1 = await skipService.getSkipSegment(episodeId);
    const endCold = Date.now();
    console.log(`Episode Lookup (Cold): ${endCold - startCold}ms`);
    console.log(`Result: ${seg1 ? seg1.start + '-' + seg1.end : 'Not Found'}`);

    // 2. WARM LOOKUP (Second time, hits RAM Cache)
    const startWarm = Date.now();
    const seg2 = await skipService.getSkipSegment(episodeId);
    const endWarm = Date.now();
    console.log(`Episode Lookup (Warm): ${endWarm - startWarm}ms`);

    // 3. Different Episode of same show (Should be warm because show is in cache)
    const startNext = Date.now();
    const seg3 = await skipService.getSkipSegment('tt0388629:1:5');
    const endNext = Date.now();
    console.log(`Different Episode (Warm Cache): ${endNext - startNext}ms`);

    process.exit(0);
}

verifyEpisodePerformance();

const skipService = require('../src/services/skip-service');
const catalogService = require('../src/services/catalog');
const userService = require('../src/services/user-service');

async function verify() {
    console.log("--- Starting Architectural Verification ---");

    try {
        
        console.log("\n[1] Verifying Catalog...");
        const onePiece = await catalogService.getShowByImdbId('tt0388629');
        if (onePiece) {
            console.log(`✅ One Piece found: ${onePiece.title} (${onePiece.totalSegments} segment episodes)`);
        } else {
            console.warn("⚠️ One Piece not found in catalog (might be first run)");
        }

        
        console.log("\n[2] Verifying Skip Service...");
        const start = Date.now();
        const segments = await skipService.getSegments('tt0388629');
        const duration = Date.now() - start;
        console.log(`✅ One Piece Segments: ${segments.length} retrieved in ${duration}ms`);
        if (duration > 1000) {
            console.warn("⚠️ Fetch was slower than expected for 'Baked' data. Check DB/Mapping.");
        }

        
        console.log("\n[3] Verifying User Stats...");
        const stats = await userService.getStats();
        console.log(`✅ Global Stats: ${stats.userCount} users, ${stats.voteCount} total votes`);

        const leaderboard = await userService.getLeaderboard(5);
        console.log(`✅ Leaderboard items: ${leaderboard.length}`);

        
        console.log("\n[4] Verifying Cache Migration...");
        const malId = await skipService.getMalId('tt0388629');
        console.log(`✅ One Piece MAL ID: ${malId}`);

        console.log("\n--- Verification Complete! ---");
    } catch (e) {
        console.error("❌ Verification Failed:", e);
    } finally {
        
        const mongo = require('../src/services/mongodb');
        await mongo.close();
        process.exit(0);
    }
}

verify();

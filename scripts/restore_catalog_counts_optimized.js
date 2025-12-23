const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { MongoClient } = require('mongodb');

async function restore() {
    console.log('[Restore] Starting optimized catalog restoration...');
    const uri = process.env.MONGODB_URI;
    const client = new MongoClient(uri);

    try {
        await client.connect();
        const db = client.db();
        const skipsCol = db.collection('skips');
        const catalogCol = db.collection('catalog');

        console.log('[Restore] Fetching all skip IDs...');
        // Only fetch the fullId field
        const allSkips = await skipsCol.find({}, { projection: { fullId: 1, _id: 0 } }).toArray();
        console.log(`[Restore] Found ${allSkips.length} skip documents.`);

        const showMap = {}; // imdbId -> count of episodes

        for (const { fullId } of allSkips) {
            if (!fullId) continue;
            const parts = fullId.split(':');
            if (parts.length < 3) continue;

            const imdbId = parts[0];
            if (!imdbId.match(/^tt\d+$/)) continue;

            if (!showMap[imdbId]) showMap[imdbId] = new Set();
            showMap[imdbId].add(`${parts[1]}:${parts[2]}`);
        }

        const showIds = Object.keys(showMap);
        console.log(`[Restore] Identified ${showIds.length} shows requiring count updates.`);

        let updated = 0;
        for (const imdbId of showIds) {
            const count = showMap[imdbId].size;

            // Build the episodes object (generic placeholders since we don't want to re-fetch all metadata now)
            // The frontend mostly cares about the totalSegments count for the main table.
            // When a user clicks, the API (/api/segments/:id) will fetch the real deal.

            const episodes = {};
            showMap[imdbId].forEach(epKey => {
                const [s, e] = epKey.split(':').map(Number);
                episodes[epKey] = { season: s, episode: e, count: 1 };
            });

            const result = await catalogCol.updateOne(
                { imdbId },
                {
                    $set: {
                        totalSegments: count,
                        episodes: episodes,
                        lastUpdated: new Date().toISOString()
                    }
                }
            );

            if (result.modifiedCount > 0 || result.upsertedCount > 0) {
                updated++;
            }

            if (updated % 100 === 0) {
                console.log(`[Restore] Updated ${updated} shows...`);
            }
        }

        console.log(`[Restore] Restoration complete! Updated ${updated} shows in catalog.`);

    } catch (e) {
        console.error('[Restore] Error:', e);
    } finally {
        await client.close();
        process.exit(0);
    }
}

restore();

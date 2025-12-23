require('dotenv').config();
const mongoService = require('./src/services/mongodb');

async function checkSegments(showId) {
    try {
        const skipsCollection = await mongoService.getCollection('skips');
        if (!skipsCollection) {
            console.log("MongoDB not available.");
            return;
        }

        console.log(`Searching segments for: ${showId}`);

        // Exact match for the show ID (series level)
        const seriesDoc = await skipsCollection.findOne({ fullId: showId });
        if (seriesDoc) {
            console.log(`Found series document for ${showId}:`);
            console.log(JSON.stringify(seriesDoc.segments, null, 2));
        } else {
            console.log(`No series-level document for ${showId}.`);
        }

        // Search for all episodes
        const cursor = skipsCollection.find({ fullId: { $regex: `^${showId}:` } });
        const eps = await cursor.toArray();
        console.log(`\nFound ${eps.length} episode documents:`);
        eps.forEach(ep => {
            console.log(`- ${ep.fullId}: ${ep.segments.length} segments`);
            console.log(JSON.stringify(ep.segments, null, 2));
        });

    } catch (e) {
        console.error("Error:", e.message);
    } finally {
        process.exit();
    }
}

const target = process.argv[2] || 'tt0944947';
checkSegments(target);

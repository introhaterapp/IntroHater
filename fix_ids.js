require('dotenv').config();
const mongoService = require('./src/services/mongodb');

async function fixDoubledIds() {
    try {
        const skipsCollection = await mongoService.getCollection('skips');
        if (!skipsCollection) {
            console.log("MongoDB not available.");
            return;
        }

        const allDocs = await skipsCollection.find({}).toArray();
        let fixCount = 0;

        for (const doc of allDocs) {
            const id = doc.fullId;
            const parts = id.split(':');

            // Check if ID is doubled: e.g. tt123:1:4:1:4 (5 parts) or tt123:1:4:tt123:1:4
            // Most likely pattern for this bug is tt123:1:4:1:4
            if (parts.length === 5 && parts[1] === parts[3] && parts[2] === parts[4]) {
                const correctId = `${parts[0]}:${parts[1]}:${parts[2]}`;
                console.log(`Fixing doubled ID: ${id} -> ${correctId}`);

                // Merge segments into the correct ID
                await skipsCollection.updateOne(
                    { fullId: correctId },
                    { $push: { segments: { $each: doc.segments } } },
                    { upsert: true }
                );

                // Remove the corrupted one
                await skipsCollection.deleteOne({ fullId: id });
                fixCount++;
            }
        }

        console.log(`Finished. Fixed ${fixCount} doubled IDs.`);

    } catch (e) {
        console.error("Error:", e.message);
    } finally {
        process.exit();
    }
}

fixDoubledIds();

require('dotenv').config();
const mongoService = require('./src/services/mongodb');

async function fixGoT() {
    try {
        const coll = await mongoService.getCollection('skips');
        if (!coll) return;

        const docs = await coll.find({ fullId: /^tt0944947:.*:.*:.*:.*/ }).toArray();
        console.log(`Found ${docs.length} corrupted GoT docs.`);

        for (const doc of docs) {
            const parts = doc.fullId.split(':');
            if (parts.length === 5 && parts[1] === parts[3] && parts[2] === parts[4]) {
                const correctId = `${parts[0]}:${parts[1]}:${parts[2]}`;
                console.log(`Moving ${doc.fullId} to ${correctId}`);

                await coll.updateOne(
                    { fullId: correctId },
                    { $push: { segments: { $each: doc.segments } } },
                    { upsert: true }
                );

                await coll.deleteOne({ fullId: doc.fullId });
            }
        }
    } catch (e) {
        console.error(e);
    } finally {
        process.exit();
    }
}

fixGoT();

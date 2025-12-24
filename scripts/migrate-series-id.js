require('dotenv').config();
const skipRepository = require('../src/repositories/skip.repository');

async function migrate() {
    console.log('[Migration] Starting seriesId migration...');
    try {
        await skipRepository.ensureInit();
        if (!skipRepository.useMongo) {
            console.log('[Migration] MongoDB not enabled. Skipping migration.');
            return;
        }

        const cursor = skipRepository.collection.find({
            seriesId: { $exists: false },
            fullId: { $regex: /:/ }
        });

        let count = 0;
        while (await cursor.hasNext()) {
            const doc = await cursor.next();
            const seriesId = doc.fullId.split(':')[0];

            await skipRepository.collection.updateOne(
                { _id: doc._id },
                { $set: { seriesId } }
            );
            count++;
            if (count % 100 === 0) {
                console.log(`[Migration] Processed ${count} documents...`);
            }
        }

        console.log(`[Migration] Finished! Migrated ${count} documents.`);
    } catch (e) {
        console.error('[Migration] Failed:', e);
    } finally {
        process.exit();
    }
}

migrate();

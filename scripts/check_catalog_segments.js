const { MongoClient } = require('mongodb');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function check() {
    const client = new MongoClient(process.env.MONGODB_URI);
    try {
        await client.connect();
        const db = client.db();
        const count = await db.collection('catalog').countDocuments({ totalSegments: { $gt: 0 } });
        console.log('DB CATALOG WITH SEGMENTS > 0:', count);

        const example = await db.collection('catalog').findOne({ totalSegments: { $gt: 0 } });
        console.log('EXAMPLE WITH SEGMENTS:', example ? example.imdbId : 'NONE');

        const exampleZero = await db.collection('catalog').findOne({ totalSegments: 0 });
        console.log('EXAMPLE WITH ZERO:', exampleZero ? exampleZero.imdbId : 'NONE');
        if (exampleZero && exampleZero.episodes) {
            console.log('ZERO ITEM HAS EPISODES:', Object.keys(exampleZero.episodes).length);
        }

    } catch (e) {
        console.error(e);
    } finally {
        await client.close();
    }
}
check();

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { MongoClient } = require('mongodb');
const skipService = require('../src/services/skip-service');
const catalogService = require('../src/services/catalog');

async function checkCounts() {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
        console.error("MONGODB_URI not found in .env");
        process.exit(1);
    }

    console.log("Connecting to MongoDB...");
    const client = new MongoClient(uri);

    try {
        await client.connect();
        const db = client.db();
        console.log(`Connected to database: ${db.databaseName}`);

        const collections = ['catalog', 'skips', 'users'];
        for (const colName of collections) {
            const count = await db.collection(colName).countDocuments();
            console.log(`Collection [${colName}]: ${count} documents total`);
        }

        const query = {
            title: { $nin: [null, 'null', 'undefined', 'Unknown Title', ''] },
            year: { $nin: [null, '????', ''] }
        };
        const filteredCount = await db.collection('catalog').countDocuments(query);
        console.log(`Collection [catalog] (Filtered): ${filteredCount} documents`);

        console.log("\nTesting skipService.getAllSegments()...");
        const allSkips = await skipService.getAllSegments();
        const skipKeys = Object.keys(allSkips);
        console.log(`Retrieved ${skipKeys.length} skip keys.`);
        if (skipKeys.length > 0) {
            console.log(`Example key: ${skipKeys[0]}`);
            console.log(`Segments for ${skipKeys[0]}: ${allSkips[skipKeys[0]].length}`);
        }

    } catch (e) {
        console.error("Connection failed:", e.message);
    } finally {
        await client.close();
        process.exit(0);
    }
}

checkCounts();

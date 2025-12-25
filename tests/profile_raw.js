require('dotenv').config();
const { MongoClient } = require('mongodb');

async function profileRaw() {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
        console.log("No MONGODB_URI");
        process.exit(1);
    }

    console.log("--- Raw MongoDB Profiling ---");

    // 1. Connection Time
    const startConnect = Date.now();
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    const db = client.db();
    const endConnect = Date.now();
    console.log(`Connect took: ${endConnect - startConnect}ms`);

    const col = db.collection('catalog');

    // 2. Small Doc Fetch (tt0807655)
    const startSmall = Date.now();
    const small = await col.findOne({ imdbId: 'tt0807655' });
    const endSmall = Date.now();
    console.log(`Small Doc Fetch: ${endSmall - startSmall}ms`);

    // 3. Large Doc Fetch (tt0388629 - One Piece)
    const startLarge = Date.now();
    const large = await col.findOne({ imdbId: 'tt0388629' });
    const endLarge = Date.now();
    console.log(`Large Doc Fetch (One Piece): ${endLarge - startLarge}ms`);

    // 4. Index usage check
    const explain = await col.find({ imdbId: 'tt0388629' }).explain();
    const stage = explain.queryPlanner.winningPlan.stage;
    console.log(`Query Plan Stage: ${stage} (Should be FETCH/IXSCAN)`);

    await client.close();
    process.exit(0);
}

profileRaw();

require('dotenv').config();
const { MongoClient } = require('mongodb');

async function check() {
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    const db = client.db();

    // Find ALL relevant users
    const allUsers = await db.collection('users').find({}).sort({ votes: -1 }).limit(20).toArray();
    console.log("Top Voters in DB:");
    allUsers.forEach((u, i) => {
        console.log(`#${i + 1} User: ${u.userId} | Votes: ${u.votes} (Type: ${typeof u.votes})`);
    });

    await client.close();
}
check();

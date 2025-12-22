const { MongoClient } = require('mongodb');

class MongoService {
    constructor() {
        this.client = null;
        this.db = null;
        this.uri = process.env.MONGODB_URI;
    }

    async connect() {
        // If already connected, return db
        if (this.db) return this.db;

        // If no URI, return null (fallback to memory/file will be handled by consumer)
        if (!this.uri) {
            if (!this.warned) {
                console.warn("[MongoDB] No MONGODB_URI provided. Using in-memory/file storage (Ephemeral).");
                this.warned = true;
            }
            return null;
        }

        try {
            this.client = new MongoClient(this.uri, { serverSelectionTimeoutMS: 5000 });
            await this.client.connect();
            this.db = this.client.db();
            const dbName = this.db.databaseName;

            // List collections to verify we are in the right place
            const collections = await this.db.listCollections().toArray();
            const names = collections.map(c => c.name);

            console.log(`[MongoDB] Connected to database: ${dbName}`);
            console.log(`[MongoDB] Collections found: [${names.join(', ')}]`);

            return this.db;
        } catch (e) {
            console.error("[MongoDB] Connection failed:", e.message);
            return null;
        }
    }

    async getCollection(name) {
        const db = await this.connect();
        if (!db) return null;
        return db.collection(name);
    }

    async close() {
        if (this.client) {
            await this.client.close();
            this.client = null;
            this.db = null;
            console.log("[MongoDB] Connection closed.");
        }
    }
}

module.exports = new MongoService();

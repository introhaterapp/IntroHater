const { MongoClient } = require('mongodb');
const log = require('../utils/logger').mongodb;

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
                log.warn('No MONGODB_URI provided. Using in-memory/file storage (Ephemeral).');
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

            log.info({ dbName }, 'Connected to database');
            log.info({ collections: names }, 'Collections found');

            return this.db;
        } catch (e) {
            log.error({ err: e.message }, 'Connection failed');
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
            log.info('Connection closed');
        }
    }
}

module.exports = new MongoService();

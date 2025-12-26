const { BaseRepository, LRUCache } = require('./base.repository');

class CacheRepository extends BaseRepository {
    constructor() {
        super('caches');
        this.cache = new LRUCache({ max: 1000, ttl: 1000 * 60 * 10 }); // 10 min TTL for MAL mappings
        this.indicesCreated = false;
    }

    async ensureInit() {
        if (this.indicesCreated) return;
        await super.ensureInit();
        try {
            await this.collection.createIndex({ key: 1 }, { unique: true });
            this.indicesCreated = true;
        } catch { /* ignore index creation errors */ }
    }

    async getCache(key) {
        const cached = this.cache.get(key);
        if (cached) return cached.value;

        const doc = await this.findOne({ key });
        if (doc) {
            this.cache.set(key, doc);
            return doc.value;
        }
        return null;
    }

    async setCache(key, value) {
        await this.ensureInit();
        this.cache.delete(key);
        return await this.updateOne(
            { key },
            { $set: { value, updatedAt: new Date().toISOString() } },
            { upsert: true }
        );
    }
}

module.exports = new CacheRepository();

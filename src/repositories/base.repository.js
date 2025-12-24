const mongoService = require('../services/mongodb');

class BaseRepository {
    constructor(collectionName) {
        this.collectionName = collectionName;
        this.collection = null;
        this.useMongo = false;
    }

    async ensureInit() {
        if (this.collection) return;
        try {
            this.collection = await mongoService.getCollection(this.collectionName);
            if (this.collection) {
                this.useMongo = true;
            }
        } catch (e) {
            console.error(`[Repository][${this.collectionName}] Init Error:`, e);
        }
    }

    async find(query = {}, options = {}) {
        await this.ensureInit();
        if (this.useMongo) {
            let cursor = this.collection.find(query);
            if (options.sort) cursor = cursor.sort(options.sort);
            if (options.skip) cursor = cursor.skip(options.skip);
            if (options.limit) cursor = cursor.limit(options.limit);
            return await cursor.toArray();
        }
        return [];
    }

    async findOne(query) {
        await this.ensureInit();
        if (this.useMongo) {
            return await this.collection.findOne(query);
        }
        return null;
    }

    async updateOne(query, update, options = {}) {
        await this.ensureInit();
        if (this.useMongo) {
            return await this.collection.updateOne(query, update, options);
        }
    }

    async replaceOne(query, replacement, options = {}) {
        await this.ensureInit();
        if (this.useMongo) {
            return await this.collection.replaceOne(query, replacement, options);
        }
    }

    async countDocuments(query = {}) {
        await this.ensureInit();
        if (this.useMongo) {
            return await this.collection.countDocuments(query);
        }
        return 0;
    }

    async aggregate(pipeline) {
        await this.ensureInit();
        if (this.useMongo) {
            return await this.collection.aggregate(pipeline).toArray();
        }
        return [];
    }
}

class SimpleLRUCache {
    constructor(maxSize = 100) {
        this.maxSize = maxSize;
        this.cache = new Map();
    }

    get(key) {
        if (!this.cache.has(key)) return null;
        const value = this.cache.get(key);
        this.cache.delete(key);
        this.cache.set(key, value);
        return value;
    }

    set(key, value) {
        if (this.cache.has(key)) {
            this.cache.delete(key);
        } else if (this.cache.size >= this.maxSize) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }
        this.cache.set(key, value);
    }

    clear() {
        this.cache.clear();
    }
}

module.exports = { BaseRepository, SimpleLRUCache };

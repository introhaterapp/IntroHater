const mongoService = require('../services/mongodb');

class SimpleLRUCache {
    constructor(maxSize = 200) {
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

    delete(key) {
        this.cache.delete(key);
    }

    has(key) {
        return this.cache.has(key);
    }

    clear() {
        this.cache.clear();
    }
}

class BaseRepository {
    constructor(collectionName) {
        this.collectionName = collectionName;
        this.collection = null;
        this.cache = new SimpleLRUCache(500); // Unified repository-level cache
    }

    async ensureInit() {
        if (this.collection) return;
        this.collection = await mongoService.getCollection(this.collectionName);
        if (!this.collection) {
            throw new Error(`[Repository][${this.collectionName}] MongoDB is required but not connected.`);
        }
    }

    async find(query = {}, options = {}) {
        await this.ensureInit();
        let cursor = this.collection.find(query);
        if (options.projection) cursor = cursor.project(options.projection);
        if (options.batchSize) cursor = cursor.batchSize(options.batchSize);
        if (options.sort) cursor = cursor.sort(options.sort);
        if (options.skip) cursor = cursor.skip(options.skip);
        if (options.limit) cursor = cursor.limit(options.limit);
        return await cursor.toArray();
    }

    async findOne(query) {
        await this.ensureInit();
        return await this.collection.findOne(query);
    }

    async insertOne(doc) {
        await this.ensureInit();
        return await this.collection.insertOne(doc);
    }

    async updateOne(query, update, options = {}) {
        await this.ensureInit();
        return await this.collection.updateOne(query, update, options);
    }

    async replaceOne(query, replacement, options = {}) {
        await this.ensureInit();
        return await this.collection.replaceOne(query, replacement, options);
    }

    async deleteOne(query) {
        await this.ensureInit();
        return await this.collection.deleteOne(query);
    }

    async countDocuments(query = {}) {
        await this.ensureInit();
        return await this.collection.countDocuments(query);
    }

    async aggregate(pipeline) {
        await this.ensureInit();
        return await this.collection.aggregate(pipeline).toArray();
    }
}

module.exports = { BaseRepository, SimpleLRUCache };

const { BaseRepository, SimpleLRUCache } = require('./base.repository');

class SkipRepository extends BaseRepository {
    constructor() {
        super('skips');
        this.cache = new SimpleLRUCache(200); // Cache 200 most recent series/videos
    }

    async ensureInit() {
        await super.ensureInit();
        if (this.useMongo) {
            try {
                await this.collection.createIndex({ fullId: 1 }, { unique: true });
                await this.collection.createIndex({ seriesId: 1 });
            } catch (e) { }
        }
    }

    async findByFullId(fullId) {
        const cached = this.cache.get(`full:${fullId}`);
        if (cached) return cached;

        const result = await this.findOne({ fullId });
        if (result) this.cache.set(`full:${fullId}`, result);
        return result;
    }

    async findByFullIdRegex(pattern, options = 'i') {
        return await this.find({ fullId: { $regex: pattern, $options: options } });
    }

    async findBySeriesId(seriesId) {
        const cached = this.cache.get(`series:${seriesId}`);
        if (cached) return cached;

        const result = await this.find({ seriesId });
        if (result) this.cache.set(`series:${seriesId}`, result);
        return result;
    }

    async addSegment(fullId, segment, seriesId = null) {
        await this.ensureInit();

        // Invalidate cache
        this.cache.clear(); // Simple full clear for safety, could be more granular
        const update = {
            $push: { segments: segment }
        };
        if (seriesId) {
            update.$set = { seriesId };
        }
        return await this.updateOne(
            { fullId },
            update,
            { upsert: true }
        );
    }

    async getGlobalStats() {
        return await this.aggregate([
            { $project: { numSegments: { $size: { $ifNull: ["$segments", []] } } } },
            { $group: { _id: null, total: { $sum: "$numSegments" } } }
        ]);
    }

    async getPendingModeration() {
        return await this.find({
            $or: [
                { "segments.verified": { $ne: true } },
                { "segments.reportCount": { $gt: 0 } }
            ]
        });
    }

    async updateSegments(fullId, segments) {
        this.cache.clear();
        return await this.updateOne({ fullId }, { $set: { segments } });
    }
}

module.exports = new SkipRepository();

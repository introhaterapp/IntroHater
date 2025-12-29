const { BaseRepository, LRUCache } = require('./base.repository');

class SkipRepository extends BaseRepository {
    constructor() {
        super('skips');
        this.cache = new LRUCache({ max: 500, ttl: 1000 * 60 * 5 }); 
        this.indicesCreated = false;
    }

    async ensureInit() {
        if (this.indicesCreated) return;
        await super.ensureInit();
        try {
            await this.collection.createIndex({ fullId: 1 }, { unique: true });
            await this.collection.createIndex({ seriesId: 1 });
            this.indicesCreated = true;
        } catch (e) {
            console.warn("[SkipRepository] Index creation warning:", e.message);
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

        const result = await this.find({ seriesId }, {
            projection: { segments: 1, fullId: 1 },
            batchSize: 1000
        });

        if (result && result.length > 0) {
            this.cache.set(`series:${seriesId}`, result);
        }
        return result;
    }

    async addSegment(fullId, segment, seriesId = null) {
        await this.ensureInit();

        
        this.cache.delete(`full:${fullId}`);
        const actualSeriesId = seriesId || (fullId.includes(':') ? fullId.split(':')[0] : null);
        if (actualSeriesId) {
            this.cache.delete(`series:${actualSeriesId}`);
        }

        const update = {
            $push: { segments: segment }
        };

        if (actualSeriesId) {
            update.$set = { seriesId: actualSeriesId };
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
        this.cache.delete(`full:${fullId}`);
        const seriesId = fullId.includes(':') ? fullId.split(':')[0] : null;
        if (seriesId) {
            this.cache.delete(`series:${seriesId}`);
        }
        return await this.updateOne({ fullId }, { $set: { segments } });
    }

    
    async getRecentSegments(limit = 20) {
        return await this.aggregate([
            { $unwind: "$segments" },
            { $match: { "segments.createdAt": { $exists: true } } },
            { $sort: { "segments.createdAt": -1 } },
            { $limit: limit },
            {
                $project: {
                    _id: 0,
                    videoId: "$fullId",
                    label: { $ifNull: ["$segments.label", "Intro"] },
                    createdAt: "$segments.createdAt",
                    source: { $ifNull: ["$segments.source", "community"] }
                }
            }
        ]);
    }
}

module.exports = new SkipRepository();

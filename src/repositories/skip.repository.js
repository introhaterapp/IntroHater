const BaseRepository = require('./base.repository');

class SkipRepository extends BaseRepository {
    constructor() {
        super('skips');
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
        return await this.findOne({ fullId });
    }

    async findByFullIdRegex(pattern, options = 'i') {
        return await this.find({ fullId: { $regex: pattern, $options: options } });
    }

    async findBySeriesId(seriesId) {
        return await this.find({ seriesId });
    }

    async addSegment(fullId, segment, seriesId = null) {
        await this.ensureInit();
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
        return await this.updateOne({ fullId }, { $set: { segments } });
    }
}

module.exports = new SkipRepository();

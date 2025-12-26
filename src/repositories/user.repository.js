const { BaseRepository } = require('./base.repository');

class UserRepository extends BaseRepository {
    constructor() {
        super('users');
        this.tokensCollection = null;
    }

    async ensureInit() {
        await super.ensureInit();
        if (this.collection && !this.tokensCollection) {
            try {
                const mongoService = require('../services/mongodb');
                this.tokensCollection = await mongoService.getCollection('tokens');
                await this.collection.createIndex({ userId: 1 }, { unique: true });
                await this.collection.createIndex({ votes: -1, segments: -1 });
                if (this.tokensCollection) {
                    await this.tokensCollection.createIndex({ userId: 1 });
                }
            } catch { /* ignore initialization errors */ }
        }
    }

    async findByUserId(userId) {
        return await this.findOne({ userId });
    }

    async getLeaderboard(limit) {
        await this.ensureInit();
        if (this.collection) {
            return await this.collection.find()
                .sort({ votes: -1, segments: -1 })
                .limit(limit)
                .toArray();
        }
        return [];
    }

    async getStatsAggregation() {
        return await this.aggregate([
            { $group: { _id: null, totalVotes: { $sum: "$votes" } } }
        ]);
    }

    async findGlobalStats() {
        return await this.findOne({ userId: "GLOBAL_STATS" });
    }

    async incrementGlobalSavedTime(duration) {
        return await this.updateOne(
            { userId: "GLOBAL_STATS" },
            { $inc: { totalSavedTime: duration } },
            { upsert: true }
        );
    }

    async findTokenByUserId(userId) {
        await this.ensureInit();
        if (this.tokensCollection) {
            return await this.tokensCollection.findOne({ userId });
        }
        return null;
    }

    async upsertToken(userId, entry) {
        await this.ensureInit();
        if (this.tokensCollection) {
            return await this.tokensCollection.updateOne({ userId }, { $set: entry }, { upsert: true });
        }
    }

    async findOneToken(userId) {
        await this.ensureInit();
        if (this.tokensCollection) {
            return await this.tokensCollection.findOne({ userId });
        }
        return null;
    }
}

module.exports = new UserRepository();

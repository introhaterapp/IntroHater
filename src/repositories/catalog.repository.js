const BaseRepository = require('./base.repository');

class CatalogRepository extends BaseRepository {
    constructor() {
        super('catalog');
    }

    async ensureInit() {
        await super.ensureInit();
        if (this.useMongo) {
            try {
                await this.collection.createIndex({ imdbId: 1 }, { unique: true });
            } catch (e) { }
        }
    }

    async getCatalogData(query, skip, limit) {
        await this.ensureInit();
        if (this.useMongo) {
            const total = await this.collection.countDocuments(query);
            const items = await this.collection.find(query)
                .sort({ title: 1 })
                .skip(skip)
                .limit(limit)
                .toArray();

            return { items, total };
        }
        return { items: [], total: 0 };
    }

    async getCatalogStats(query) {
        await this.ensureInit();
        if (this.useMongo) {
            const showCount = await this.collection.countDocuments(query);
            const result = await this.collection.aggregate([
                { $match: query },
                {
                    $project: {
                        numEpisodes: {
                            $size: {
                                $objectToArray: { $ifNull: ["$episodes", {}] }
                            }
                        }
                    }
                },
                { $group: { _id: null, total: { $sum: "$numEpisodes" } } }
            ]).toArray();
            const episodeCount = result[0]?.total || 0;
            return { showCount, episodeCount };
        }
        return { showCount: 0, episodeCount: 0 };
    }

    async findByImdbId(imdbId) {
        return await this.findOne({ imdbId });
    }

    async upsertCatalogEntry(imdbId, entry) {
        return await this.replaceOne({ imdbId }, { imdbId, ...entry }, { upsert: true });
    }
}

module.exports = new CatalogRepository();

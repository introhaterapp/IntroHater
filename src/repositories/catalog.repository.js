const { BaseRepository } = require('./base.repository');

class CatalogRepository extends BaseRepository {
    constructor() {
        super('catalog');
        this.indicesCreated = false;
    }

    async ensureInit() {
        if (this.indicesCreated) return;
        await super.ensureInit();
        try {
            await this.collection.createIndex({ imdbId: 1 }, { unique: true });
            this.indicesCreated = true;
        } catch (e) {
            console.warn("[CatalogRepository] Index creation warning:", e.message);
        }
    }

    async getCatalogData(query, skip, limit, search = '', sort = { title: 1 }) {
        await this.ensureInit();
        let finalQuery = { ...query };
        if (search) {
            finalQuery.$or = [
                { title: { $regex: search, $options: 'i' } },
                { imdbId: { $regex: search, $options: 'i' } }
            ];
        }

        const total = await this.collection.countDocuments(query);
        const filteredTotal = search ? await this.collection.countDocuments(finalQuery) : total;

        // Exclude the heavy episodes map entirely for the catalog table view
        // This makes the list view extremely fast even with thousands of shows
        const items = await this.collection.find(finalQuery, {
            projection: { episodes: 0 }
        })
            .sort(sort)
            .skip(skip)
            .limit(limit)
            .toArray();

        return { items, total, filteredTotal };
    }

    async getCatalogStats(query) {
        await this.ensureInit();
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

    async findByImdbId(imdbId) {
        return await this.findOne({ imdbId });
    }

    async upsertCatalogEntry(imdbId, entry) {
        return await this.replaceOne({ imdbId }, { imdbId, ...entry }, { upsert: true });
    }
}

module.exports = new CatalogRepository();

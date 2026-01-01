const { BaseRepository } = require('./base.repository');

class BannerRepository extends BaseRepository {
    constructor() {
        super('bannerConfig');
    }

    async getBannerConfig() {
        const config = await this.findOne({ _id: 'global' });
        return config || {
            enabled: false,
            message: '',
            level: 'info',
            updatedAt: null
        };
    }

    async updateBannerConfig(message, level, enabled) {
        const config = {
            _id: 'global',
            message: message || '',
            level: level || 'info',
            enabled: !!enabled,
            updatedAt: new Date()
        };

        await this.replaceOne({ _id: 'global' }, config, { upsert: true });
        return config;
    }
}

module.exports = new BannerRepository();

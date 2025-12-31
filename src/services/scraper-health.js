const axios = require('axios');

class ScraperHealthService {
    constructor() {
        this.status = {
            torrentio: { name: 'Torrentio', status: 'unknown', lastCheck: null, latency: 0 },
            comet: { name: 'Comet', status: 'unknown', lastCheck: null, latency: 0 },
            mediafusion: { name: 'MediaFusion', status: 'unknown', lastCheck: null, latency: 0 },
            introdb: { name: 'IntroDB', status: 'unknown', lastCheck: null, latency: 0 },
            mongodb: { name: 'Database', status: 'unknown', lastCheck: null, latency: 0 }
        };


        this.backgroundCheck();
        setInterval(() => this.backgroundCheck(), 30 * 60 * 1000);
    }

    updateStatus(key, status, latency = 0) {
        if (this.status[key]) {
            this.status[key].status = status;
            this.status[key].lastCheck = new Date();
            this.status[key].latency = latency;
        }
    }

    getStatus() {
        return this.status;
    }

    async backgroundCheck() {
        console.log('[ScraperHealth] Starting background health checks...');
        const checkService = async (key, url, timeout = 5000) => {
            const start = Date.now();
            try {
                const response = await axios.get(url, {
                    timeout,
                    headers: { 'User-Agent': 'IntroHater-HealthCheck/1.0' }
                });
                const latency = Date.now() - start;
                let status = (response.status >= 200 && response.status < 400) ? 'online' : 'degraded';

                const title = (response.data?.streams?.[0]?.title || '').toLowerCase();
                if (title.includes('rate limit') || title.includes('public instance') || title.includes('donate')) {
                    status = 'degraded';
                }

                console.log(`[ScraperHealth] Check for ${key} finished: ${status} (${latency}ms)`);
                this.updateStatus(key, status, latency);
            } catch (e) {
                const status = e.response?.status === 403 ? 'blocked' : 'offline';
                console.log(`[ScraperHealth] Check for ${key} failed: ${status}`);
                this.updateStatus(key, status, Date.now() - start);
            }
        };

        const checkMongo = async () => {
            const start = Date.now();
            try {
                const mongoService = require('./mongodb');
                const db = await mongoService.connect();
                const isConnected = !!db;
                console.log(`[ScraperHealth] Check for mongodb finished: ${isConnected ? 'online' : 'offline'}`);
                this.updateStatus('mongodb', isConnected ? 'online' : 'offline', Date.now() - start);
            } catch (e) {
                console.log(`[ScraperHealth] Check for mongodb failed: ${e.message}`);
                this.updateStatus('mongodb', 'offline', Date.now() - start);
            }
        };

        await Promise.allSettled([
            checkService('torrentio', 'https://torrentio.strem.fun/manifest.json'),
            checkService('comet', 'https://comet.elfhosted.com/manifest.json'),
            checkService('mediafusion', 'https://mediafusion.elfhosted.com/manifest.json'),
            checkService('introdb', 'https://api.introdb.app/intro?imdb_id=tt0944947&season=1&episode=1'),
            checkMongo()
        ]);
        console.log('[ScraperHealth] All background health checks completed.');
    }
}

module.exports = new ScraperHealthService();

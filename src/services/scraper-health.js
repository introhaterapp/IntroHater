const axios = require('axios');

const HEALTH_CHECK_HEADERS = {
    'User-Agent': 'Stremio/4.4',
    'Accept': 'application/json'
};

const SERVICE_CHECKS = [
    { key: 'torrentio', name: 'Torrentio', url: 'https://torrentio.strem.fun/manifest.json', timeout: 8000 },
    { key: 'comet', name: 'Comet', url: 'https://comet.elfhosted.com/manifest.json', timeout: 12000 },
    { key: 'mediafusion', name: 'MediaFusion', url: 'https://mediafusion.elfhosted.com/manifest.json', timeout: 8000 },
    { key: 'introdb', name: 'IntroDB', url: 'https://api.introdb.app/intro?imdb_id=tt0944947&season=1&episode=1', timeout: 8000, isIntroDb: true }
];

function evaluateManifestResponse(data) {
    if (data && (data.id || data.name)) {
        return { status: 'online', detail: null };
    }
    return { status: 'degraded', detail: 'Unexpected response format' };
}

function evaluateIntroDbResponse(data) {
    if (data && typeof data === 'object') {
        return { status: 'online', detail: null };
    }
    return { status: 'degraded', detail: 'Unexpected response format' };
}

function classifyServiceError(error) {
    const httpStatus = error.response?.status;

    if (httpStatus === 403 || httpStatus === 451) {
        return {
            status: 'unreachable',
            detail: 'CDN blocked from server (likely fine for users)'
        };
    }

    if (httpStatus === 429) {
        return { status: 'degraded', detail: 'Rate limited' };
    }

    if (httpStatus >= 500) {
        return { status: 'degraded', detail: `HTTP ${httpStatus}` };
    }

    const code = error.code;
    if (code === 'ECONNABORTED' || code === 'ETIMEDOUT') {
        return { status: 'timeout', detail: 'Request timed out from server' };
    }

    if (code === 'ENOTFOUND' || code === 'ECONNREFUSED' || code === 'EHOSTUNREACH') {
        return { status: 'offline', detail: code };
    }

    return { status: 'offline', detail: error.message || 'Unreachable' };
}

async function checkServiceEndpoint(axiosGet, { url, timeout, isIntroDb }) {
    const start = Date.now();
    try {
        const response = await axiosGet(url, {
            timeout,
            headers: HEALTH_CHECK_HEADERS,
            validateStatus: (status) => status < 500
        });
        const latency = Date.now() - start;

        if (response.status >= 400) {
            const classified = classifyServiceError({
                response: { status: response.status },
                message: `HTTP ${response.status}`
            });
            return { ...classified, latency };
        }

        const evaluated = isIntroDb
            ? evaluateIntroDbResponse(response.data)
            : evaluateManifestResponse(response.data);

        return { ...evaluated, latency };
    } catch (error) {
        return { ...classifyServiceError(error), latency: Date.now() - start };
    }
}

class ScraperHealthService {
    constructor() {
        this.status = Object.fromEntries(
            [...SERVICE_CHECKS, { key: 'mongodb', name: 'Database' }].map(({ key, name }) => [
                key,
                { name, status: 'unknown', lastCheck: null, latency: 0, detail: null }
            ])
        );

        this.backgroundCheck();
        setInterval(() => this.backgroundCheck(), 30 * 60 * 1000);
    }

    updateStatus(key, status, latency = 0, detail = null) {
        if (this.status[key]) {
            this.status[key].status = status;
            this.status[key].lastCheck = new Date();
            this.status[key].latency = latency;
            this.status[key].detail = detail;
        }
    }

    getStatus() {
        return this.status;
    }

    async backgroundCheck() {
        console.log('[ScraperHealth] Starting background health checks...');

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
                this.updateStatus('mongodb', 'offline', Date.now() - start, e.message);
            }
        };

        const serviceChecks = SERVICE_CHECKS.map(async (service) => {
            const result = await checkServiceEndpoint(axios.get, service);
            console.log(
                `[ScraperHealth] Check for ${service.key} finished: ${result.status}` +
                (result.detail ? ` (${result.detail})` : '') +
                ` (${result.latency}ms)`
            );
            this.updateStatus(service.key, result.status, result.latency, result.detail);
        });

        await Promise.allSettled([...serviceChecks, checkMongo()]);
        console.log('[ScraperHealth] All background health checks completed.');
    }
}

const service = new ScraperHealthService();

module.exports = service;
module.exports.evaluateManifestResponse = evaluateManifestResponse;
module.exports.evaluateIntroDbResponse = evaluateIntroDbResponse;
module.exports.classifyServiceError = classifyServiceError;
module.exports.checkServiceEndpoint = checkServiceEndpoint;
module.exports.SERVICE_CHECKS = SERVICE_CHECKS;

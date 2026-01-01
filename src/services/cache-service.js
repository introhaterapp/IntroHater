
const log = require('../utils/logger').cache;


class LRUCache {
    constructor(maxSize = 500, ttlMs = 3600000) {
        this.maxSize = maxSize;
        this.ttlMs = ttlMs;
        this.cache = new Map();
    }

    get(key) {
        if (!this.cache.has(key)) return null;
        const entry = this.cache.get(key);


        if (this.ttlMs && Date.now() - entry.timestamp > this.ttlMs) {
            this.cache.delete(key);
            return null;
        }


        this.cache.delete(key);
        this.cache.set(key, entry);
        return entry.value;
    }

    set(key, value) {
        if (this.cache.has(key)) this.cache.delete(key);
        else if (this.cache.size >= this.maxSize) {

            this.cache.delete(this.cache.keys().next().value);
        }
        this.cache.set(key, { value, timestamp: Date.now() });
    }

    has(key) {
        const value = this.get(key);
        return value !== null;
    }

    delete(key) {
        this.cache.delete(key);
    }

    clear() {
        this.cache.clear();
    }

    get size() {
        return this.cache.size;
    }


    gc() {
        if (!this.ttlMs) return 0;
        const cutoff = Date.now() - this.ttlMs;
        let removed = 0;
        for (const [key, entry] of this.cache) {
            if (entry.timestamp < cutoff) {
                this.cache.delete(key);
                removed++;
            }
        }
        return removed;
    }
}


const metadataCache = new LRUCache(2000, 3600000);


const loggedHistory = new LRUCache(5000, 3600000);


const manifestCache = new LRUCache(1000, null);


const probeCache = new LRUCache(1000, 30 * 60 * 1000);

// Cache for scraper config hash -> full URL (24 hour TTL)
const scraperConfigCache = new LRUCache(10000, 24 * 60 * 60 * 1000);


function getMetadata(imdbId) {
    return metadataCache.get(imdbId);
}


function setMetadata(imdbId, data) {
    metadataCache.set(imdbId, data);
}


function isWatchLogged(userId, videoId) {
    const key = `${userId}:${videoId}`;
    return loggedHistory.has(key);
}


function logWatch(userId, videoId) {
    const key = `${userId}:${videoId}`;
    loggedHistory.set(key, Date.now());
}


function getManifest(cacheKey) {
    return manifestCache.get(cacheKey);
}


function setManifest(cacheKey, manifest) {
    manifestCache.set(cacheKey, manifest);
}


function hasManifest(cacheKey) {
    return manifestCache.has(cacheKey);
}


function getCachedProbe(key) {
    return probeCache.get(key);
}



function setCachedProbe(key, value) {
    probeCache.set(key, value);
}

// Scraper config hash -> full URL
function getScraperConfig(hash) {
    return scraperConfigCache.get(hash);
}

function setScraperConfig(hash, scraperUrl) {
    scraperConfigCache.set(hash, scraperUrl);
}


setInterval(() => {
    const metaRemoved = metadataCache.gc();
    const historyRemoved = loggedHistory.gc();
    const scraperRemoved = scraperConfigCache.gc();
    if (metaRemoved > 0 || historyRemoved > 0 || scraperRemoved > 0) {
        log.info({ metaRemoved, historyRemoved, scraperRemoved }, 'GC cleanup');
    }
}, 300000);

module.exports = {
    LRUCache,
    getMetadata,
    setMetadata,
    isWatchLogged,
    logWatch,
    getManifest,
    setManifest,
    hasManifest,
    getCachedProbe,
    setCachedProbe,
    getScraperConfig,
    setScraperConfig,

    _metadataCache: metadataCache,
    _loggedHistory: loggedHistory,
    _manifestCache: manifestCache,
    _probeCache: probeCache,
    _scraperConfigCache: scraperConfigCache
};

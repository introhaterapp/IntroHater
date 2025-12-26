/**
 * CacheService - Centralized cache management
 * Replaces global.metadataCache and global.loggedHistory
 */
const log = require('../utils/logger').cache;

// Simple LRU Cache with TTL support
class LRUCache {
    constructor(maxSize = 500, ttlMs = 3600000) {
        this.maxSize = maxSize;
        this.ttlMs = ttlMs;
        this.cache = new Map();
    }

    get(key) {
        if (!this.cache.has(key)) return null;
        const entry = this.cache.get(key);

        // Check TTL
        if (this.ttlMs && Date.now() - entry.timestamp > this.ttlMs) {
            this.cache.delete(key);
            return null;
        }

        // Move to end (most recently used)
        this.cache.delete(key);
        this.cache.set(key, entry);
        return entry.value;
    }

    set(key, value) {
        if (this.cache.has(key)) this.cache.delete(key);
        else if (this.cache.size >= this.maxSize) {
            // Delete oldest entry
            this.cache.delete(this.cache.keys().next().value);
        }
        this.cache.set(key, { value, timestamp: Date.now() });
    }

    has(key) {
        const value = this.get(key); // This also checks TTL
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

    // Garbage collect expired entries
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

// Metadata cache (show titles, posters)
const metadataCache = new LRUCache(2000, 3600000); // 2000 items, 1 hour TTL

// Telemetry deduplication (logged watches)
const loggedHistory = new LRUCache(5000, 3600000); // 5000 items, 1 hour TTL

// HLS manifest cache (no TTL, just LRU)
const manifestCache = new LRUCache(1000, null);

// Probe cache for HLS (30 min TTL)
const probeCache = new LRUCache(1000, 30 * 60 * 1000);

/**
 * Get cached metadata for an IMDB ID
 * @param {string} imdbId
 * @returns {object|null}
 */
function getMetadata(imdbId) {
    return metadataCache.get(imdbId);
}

/**
 * Cache metadata for an IMDB ID
 * @param {string} imdbId
 * @param {object} data - { Title, Poster, ... }
 */
function setMetadata(imdbId, data) {
    metadataCache.set(imdbId, data);
}

/**
 * Check if a watch has been logged for a user/video combo
 * @param {string} userId
 * @param {string} videoId
 * @returns {boolean}
 */
function isWatchLogged(userId, videoId) {
    const key = `${userId}:${videoId}`;
    return loggedHistory.has(key);
}

/**
 * Log a watch for a user/video combo
 * @param {string} userId
 * @param {string} videoId
 */
function logWatch(userId, videoId) {
    const key = `${userId}:${videoId}`;
    loggedHistory.set(key, Date.now());
}

/**
 * Get cached HLS manifest
 * @param {string} cacheKey
 * @returns {string|null}
 */
function getManifest(cacheKey) {
    return manifestCache.get(cacheKey);
}

/**
 * Cache HLS manifest
 * @param {string} cacheKey
 * @param {string} manifest
 */
function setManifest(cacheKey, manifest) {
    manifestCache.set(cacheKey, manifest);
}

/**
 * Check if manifest is cached
 * @param {string} cacheKey
 * @returns {boolean}
 */
function hasManifest(cacheKey) {
    return manifestCache.has(cacheKey);
}

/**
 * Get cached probe result
 * @param {string} key
 * @returns {any|null}
 */
function getCachedProbe(key) {
    return probeCache.get(key);
}

/**
 * Store probe result in cache
 * @param {string} key
 * @param {any} value
 */
function setCachedProbe(key, value) {
    probeCache.set(key, value);
}

// Run garbage collection periodically
setInterval(() => {
    const metaRemoved = metadataCache.gc();
    const historyRemoved = loggedHistory.gc();
    if (metaRemoved > 0 || historyRemoved > 0) {
        log.info({ metaRemoved, historyRemoved }, 'GC cleanup');
    }
}, 300000); // Every 5 minutes

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
    // Expose for testing
    _metadataCache: metadataCache,
    _loggedHistory: loggedHistory,
    _manifestCache: manifestCache,
    _probeCache: probeCache
};

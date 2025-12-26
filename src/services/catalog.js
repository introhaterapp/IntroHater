const axios = require('axios');
const catalogRepository = require('../repositories/catalog.repository');
const log = require('../utils/logger').catalog;

async function ensureInit() {
    await catalogRepository.ensureInit();
}

/**
 * Fetch metadata for an IMDB ID
 * @param {string} imdbId
 * @returns {Promise<Object>} Metadata object { Title, Year, Poster }
 */
async function fetchMetadata(imdbId) {
    const omdbKey = process.env.OMDB_API_KEY;
    let data = null;

    // 1. Try OMDB
    if (omdbKey) {
        try {
            const response = await axios.get(`http://www.omdbapi.com/?i=${imdbId}&apikey=${omdbKey}`);
            if (response.data && response.data.Response !== "False") {
                data = {
                    Title: response.data.Title,
                    Year: response.data.Year,
                    Poster: response.data.Poster !== "N/A" ? response.data.Poster : null
                };
            }
        } catch (error) {
            log.error({ err: error.message }, 'OMDB Error');
        }
    }

    // 2. Fallback to Cinemeta
    if (!data) {
        try {
            const type = imdbId.startsWith('tt') ? (await isSeries(imdbId) ? 'series' : 'movie') : 'series';
            const response = await axios.get(`https://v3-cinemeta.strem.io/meta/${type}/${imdbId}.json`);
            const meta = response.data?.meta;
            if (meta) {
                data = {
                    Title: meta.name,
                    Year: meta.year || meta.releaseInfo || "????",
                    Poster: meta.poster || null
                };
            }
        } catch (error) {
            log.error({ err: error.message }, 'Cinemeta Fallback Error');
        }
    }

    // 3. Last Resort
    if (!data) {
        data = {
            Title: imdbId,
            Year: "????",
            Poster: null
        };
    }

    return data;
}

/**
 * Check if an IMDB ID is a series
 * @param {string} imdbId
 * @returns {Promise<boolean>}
 */
async function isSeries(imdbId) {
    try {
        const res = await axios.get(`https://v3-cinemeta.strem.io/meta/series/${imdbId}.json`);
        return !!res.data?.meta;
    } catch { return false; }
}

/**
 * Register a show in the catalog
 * @param {string} videoId
 * @param {number|null} segmentCount
 * @param {Array|null} segments
 * @returns {Promise<void>}
 */
async function registerShow(videoId, segmentCount = null, segments = null) {
    const parts = String(videoId).split(':');
    const imdbId = parts[0];

    if (!imdbId.match(/^tt\d+$/)) {
        log.warn({ imdbId }, 'Rejected invalid ID');
        return;
    }

    const season = parts[1] ? parseInt(parts[1]) : null;
    const episode = parts[2] ? parseInt(parts[2]) : null;

    await ensureInit();
    let media = await catalogRepository.findByImdbId(imdbId);

    // If show exists and we are just "checking" without new segments, return early
    if (media && !segments) {
        const lastUpdated = new Date(media.lastUpdated).getTime();
        const now = Date.now();
        const age = now - lastUpdated;

        // If updated in last 24 hours, don't even think about re-registering
        if (age < 24 * 60 * 60 * 1000) return;
    }

    if (!media) {
        const meta = await fetchMetadata(imdbId);
        if (!meta) return;

        media = {
            imdbId,
            title: meta.Title,
            year: meta.Year,
            poster: meta.Poster,
            type: season && episode ? 'show' : 'movie',
            episodes: {},
            addedAt: new Date().toISOString(),
            lastUpdated: new Date().toISOString(),
            totalSegments: 0
        };
    }

    if (season && episode) {
        const epKey = `${season}:${episode}`;
        if (!media.episodes) media.episodes = {};
        if (!media.episodes[epKey]) {
            media.episodes[epKey] = { season, episode, count: 0 };
        }

        if (segmentCount !== null) {
            media.episodes[epKey].count = segmentCount;
        } else {
            media.episodes[epKey].count++;
        }

        if (segments) {
            media.episodes[epKey].segments = segments;
        }
    }

    media.totalSegments = Object.keys(media.episodes || {}).length;
    media.lastUpdated = new Date().toISOString();

    await catalogRepository.upsertCatalogEntry(imdbId, media);
}

/**
 * Bakes all segments for a show into its catalog entry for high-speed retrieval.
 * @param {string} imdbId
 * @param {Object} segmentsByEpisode
 * @returns {Promise<void>}
 */
async function bakeShowSegments(imdbId, segmentsByEpisode) {
    await ensureInit();
    let media = await catalogRepository.findByImdbId(imdbId);
    if (!media) {
        // Register manually if it doesn't exist
        await registerShow(imdbId + ":1:1", 0);
        media = await catalogRepository.findByImdbId(imdbId);
    }

    if (!media) return;
    if (!media.episodes) media.episodes = {};

    for (const [epKey, segments] of Object.entries(segmentsByEpisode)) {
        const [s, e] = epKey.split(':').map(Number);
        if (!media.episodes[epKey]) {
            media.episodes[epKey] = { season: s, episode: e, count: 0 };
        }

        // Handle both full segment arrays and just counts
        if (Array.isArray(segments)) {
            media.episodes[epKey].segments = segments;
            media.episodes[epKey].count = segments.length;
        } else if (typeof segments === 'number') {
            media.episodes[epKey].count = segments;
        } else if (typeof segments === 'object') {
            // Handle case where we might just be updating counts
            media.episodes[epKey].count = segments.count || 0;
        }
    }

    media.totalSegments = Object.keys(media.episodes).length;
    media.lastUpdated = new Date().toISOString();
    await catalogRepository.upsertCatalogEntry(imdbId, media);
}

/**
 * Get show data by IMDB ID
 * @param {string} imdbId
 * @returns {Promise<Object|null>}
 */
async function getShowByImdbId(imdbId) {
    await ensureInit();
    return await catalogRepository.findByImdbId(imdbId);
}

/**
 * Get catalog data with pagination, search and sort
 * @returns {Promise<Object>} Catalog response object
 */
async function getCatalogData(page = 1, limit = 1000, search = '', sort = { title: 1 }) {
    await ensureInit();
    const skip = (page - 1) * limit;

    const query = {
        title: { $nin: [null, 'null', 'undefined', 'Unknown Title', ''] },
        year: { $nin: [null, '????', ''] },
        totalSegments: { $gt: 0 }
    };

    const { items, total, filteredTotal } = await catalogRepository.getCatalogData(query, skip, limit, search, sort);

    const media = {};
    items.forEach(item => {
        const { ...rest } = item;
        media[item.imdbId] = rest;
    });

    return {
        lastUpdated: new Date().toISOString(),
        media,
        total,
        filteredTotal,
        pagination: {
            page,
            limit,
            total: filteredTotal,
            pages: Math.ceil(filteredTotal / limit)
        }
    };
}

/**
 * Get global catalog statistics
 * @returns {Promise<Object>}
 */
async function getCatalogStats() {
    await ensureInit();
    const query = {
        title: { $nin: [null, 'null', 'undefined', 'Unknown Title', ''] },
        year: { $nin: [null, '????', ''] }
    };
    return await catalogRepository.getCatalogStats(query);
}

/**
 * Repair/Sync catalog from source of truth
 * @param {Object} allSkips
 * @returns {Promise<void>}
 */
async function repairCatalog(allSkips) {
    if (!allSkips) return;

    const skipKeys = Object.keys(allSkips);
    log.info({ count: skipKeys.length }, 'Running database-only catalog sync');

    if (skipKeys.length < 5) { // Lower threshold for DB-only
        log.warn('Aborting repair: Source of truth looks suspicious');
        return;
    }

    let changes = 0;
    const showMap = {}; // imdbId -> { epKey -> segments }

    for (const [fullId, segments] of Object.entries(allSkips)) {
        const parts = fullId.split(':');
        if (parts.length < 3) continue;

        const imdbId = parts[0];
        const season = parseInt(parts[1]);
        const episode = parseInt(parts[2]);
        const epKey = `${season}:${episode}`;

        if (!showMap[imdbId]) showMap[imdbId] = {};
        showMap[imdbId][epKey] = segments;
    }

    // Sync in batches to not blow up memory
    for (const [imdbId, episodes] of Object.entries(showMap)) {
        try {
            await bakeShowSegments(imdbId, episodes);
            changes++;
            if (changes % 50 === 0) log.info({ changes }, 'Synced shows');
        } catch (e) {
            log.error({ imdbId, err: e.message }, 'Failed to sync show');
        }
    }

    log.info({ totalProcessed: changes }, 'Database Rebuild/Sync Complete');
}

module.exports = {
    registerShow,
    getCatalogData,
    repairCatalog,
    getCatalogStats,
    bakeShowSegments,
    getShowByImdbId,
    fetchMetadata
};

const axios = require('axios');
const mongoService = require('./mongodb');

// Persistence State
let useMongo = false;
let catalogCollection = null;
let statsCache = null;
let lastStatsTime = 0;

async function ensureInit() {
    if (catalogCollection) return;
    try {
        catalogCollection = await mongoService.getCollection('catalog');
        if (catalogCollection) {
            useMongo = true;
            try {
                await catalogCollection.createIndex({ imdbId: 1 }, { unique: true });
            } catch (e) { }
        }
    } catch (e) {
        console.error("[Catalog] Mongo Init Error:", e);
    }
}

async function ensureCatalogDir() {
    try {
        await fs.mkdir(CATALOG_DIR, { recursive: true });
    } catch (error) {
        console.error('Error creating catalog directory:', error);
    }
}

async function readCatalog() {
    await ensureInit();
    if (useMongo) {
        const items = await catalogCollection.find({}).toArray();
        const media = {};
        items.forEach(item => {
            const { _id, ...rest } = item;
            media[item.imdbId] = rest;
        });
        return { lastUpdated: new Date().toISOString(), media };
    }
    // Fallback to local file if Mongo not available (legacy)
    try {
        const fs = require('fs').promises;
        const path = require('path');
        const CATALOG_FILE = path.join(__dirname, '../../data/catalog.json');
        const data = await fs.readFile(CATALOG_FILE, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        return { lastUpdated: null, media: {} };
    }
}

async function writeCatalogEntry(imdbId, entry) {
    await ensureInit();
    if (useMongo) {
        await catalogCollection.replaceOne({ imdbId }, { imdbId, ...entry }, { upsert: true });
    } else {
        // Limited file-based write for backward compatibility
        try {
            const fs = require('fs').promises;
            const path = require('path');
            const CATALOG_FILE = path.join(__dirname, '../../data/catalog.json');
            const catalog = await readCatalog();
            catalog.media[imdbId] = entry;
            catalog.lastUpdated = new Date().toISOString();
            await fs.writeFile(CATALOG_FILE, JSON.stringify(catalog, null, 2));
        } catch (e) { }
    }
}

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
            console.error('[Catalog] OMDB Error:', error.message);
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
            console.error('[Catalog] Cinemeta Fallback Error:', error.message);
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

async function isSeries(imdbId) {
    try {
        const res = await axios.get(`https://v3-cinemeta.strem.io/meta/series/${imdbId}.json`);
        return !!res.data?.meta;
    } catch (e) { return false; }
}

/**
 * Universal Registration: Track availability across sources
 * @param {string} videoId Format: tt123456 or tt123456:S:E
 */
async function registerShow(videoId) {
    const catalog = await readCatalog();
    const parts = videoId.split(':');
    const imdbId = parts[0];

    // VALIDATE ID: Prevent catalog spam with fake IDs
    if (!imdbId.match(/^tt\d+$/)) {
        console.warn(`[Catalog] Rejected invalid ID: ${imdbId}`);
        return;
    }

    const season = parts[1] ? parseInt(parts[1]) : null;
    const episode = parts[2] ? parseInt(parts[2]) : null;

    if (!catalog.media[imdbId]) {
        const meta = await fetchMetadata(imdbId);
        if (!meta) return;

        catalog.media[imdbId] = {
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

    const media = catalog.media[imdbId];

    if (season && episode) {
        const epKey = `${season}:${episode}`;
        if (!media.episodes[epKey]) {
            media.episodes[epKey] = {
                season, episode, count: 0
            };
        }
        media.episodes[epKey].count++;
    }

    // Fix: Count unique episodes with segments, not total hits
    media.totalSegments = Object.keys(media.episodes).length;
    media.lastUpdated = new Date().toISOString();

    await writeCatalogEntry(imdbId, media);
}

async function updateCatalog(segment) {
    return await registerShow(segment.videoId);
}

async function getCatalogData() {
    const data = await readCatalog();
    // Filter out entries with no title or year
    if (data.media) {
        const cleanMedia = {};
        for (const [id, item] of Object.entries(data.media)) {
            // Strict filtering: logic to reject bad data
            const hasTitle = item.title && item.title !== 'null' && item.title !== 'undefined' && item.title !== 'Unknown Title';
            const hasYear = item.year && item.year !== '????';

            if (hasTitle && hasYear) {
                cleanMedia[id] = item;
            }
        }
        data.media = cleanMedia;
    }
    return data;
}

async function getCatalogStats() {
    const now = Date.now();
    // Cache for 60 seconds to prevent 524 Timeouts on heavy load
    if (statsCache && (now - lastStatsTime < 60000)) {
        return statsCache;
    }

    const data = await readCatalog();
    let showCount = 0;
    let episodeCount = 0;

    if (data.media) {
        // Only count valid entries
        const entries = Object.values(data.media).filter(item => {
            return item.title && item.title !== 'null' && item.title !== 'undefined' && item.title !== 'Unknown Title' && item.year !== '????';
        });
        showCount = entries.length;
        entries.forEach(item => {
            episodeCount += Object.keys(item.episodes || {}).length;
        });
    }

    statsCache = { showCount, episodeCount };
    lastStatsTime = now;
    return statsCache;
}

async function repairCatalog(allSkips) {
    if (!allSkips) return;
    console.log('[Catalog] Running catalog repair from source of truth...');
    const catalog = await readCatalog();
    let changes = 0;

    // 1. Reset / Prepare Catalog Entries
    // We assume catalog entries exist for the shows. If not, they will be added lazily by future lookups.
    // We want to fix counts for existing entries.
    if (!catalog.media) return;

    // Clear existing episode maps to ensure a clean rebuild
    for (const item of Object.values(catalog.media)) {
        item.episodes = {};
        item.totalSegments = 0;
    }

    // 2. Iterate ALL Skips (Source of Truth)
    // allSkips is expected to be a map: { "tt123:1:1": [segments], ... }
    for (const fullId of Object.keys(allSkips)) {
        const parts = fullId.split(':');
        if (parts.length < 3) continue; // Skip movies or invalid IDs for now

        const imdbId = parts[0];
        const season = parseInt(parts[1]);
        const episode = parseInt(parts[2]);

        if (catalog.media[imdbId]) {
            const media = catalog.media[imdbId];
            const epKey = `${season}:${episode}`;

            if (!media.episodes[epKey]) {
                media.episodes[epKey] = { season, episode, count: 0 };
            }
            media.episodes[epKey].count++; // We could count number of segments for this episode
        }
    }

    // 3. Finalize Counts & Save
    for (const [id, item] of Object.entries(catalog.media)) {
        const correctCount = Object.keys(item.episodes || {}).length;
        if (item.totalSegments !== correctCount || correctCount > 0) { // Save if it has segments or we changed it
            item.totalSegments = correctCount;
            // Only save if meaningful
            changes++;
            await writeCatalogEntry(id, item);
        }
    }
    console.log(`[Catalog] Rebuilt counts for ${changes} shows.`);
}

module.exports = {
    updateCatalog,
    registerShow,
    getCatalogData,
    repairCatalog,
    getCatalogStats
};

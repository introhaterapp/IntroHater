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
    const parts = videoId.split(':');
    const imdbId = parts[0];

    // VALIDATE ID: Prevent catalog spam with fake IDs
    if (!imdbId.match(/^tt\d+$/)) {
        console.warn(`[Catalog] Rejected invalid ID: ${imdbId}`);
        return;
    }

    const season = parts[1] ? parseInt(parts[1]) : null;
    const episode = parts[2] ? parseInt(parts[2]) : null;

    await ensureInit();
    let media = null;
    if (useMongo) {
        media = await catalogCollection.findOne({ imdbId });
    } else {
        const catalog = await readCatalog();
        media = catalog.media[imdbId];
    }

    if (!media) {
        const meta = await fetchMetadata(imdbId);
        if (!meta) return;

        media = {
            imdbId, // Ensure ID is stored
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
        if (!media.episodes[epKey]) {
            media.episodes[epKey] = {
                season, episode, count: 0
            };
        }
        media.episodes[epKey].count++;
    }

    // Fix: Count unique episodes with segments, not total hits
    media.totalSegments = Object.keys(media.episodes || {}).length;
    media.lastUpdated = new Date().toISOString();

    await writeCatalogEntry(imdbId, media);
}

/**
 * Enhanced registerShow to handle segment updates without metadata fetch if entry exists
 */
async function registerShowV2(videoId, segmentCount = 1) {
    const parts = videoId.split(':');
    const imdbId = parts[0];
    const season = parts[1] ? parseInt(parts[1]) : null;
    const episode = parts[2] ? parseInt(parts[2]) : null;

    if (!imdbId.match(/^tt\d+$/)) return;

    await ensureInit();
    let media = null;
    if (useMongo) {
        media = await catalogCollection.findOne({ imdbId });
    } else {
        const catalog = await readCatalog();
        media = catalog.media[imdbId];
    }

    if (!media) {
        const meta = await fetchMetadata(imdbId);
        if (!meta) return;
        media = {
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
        if (!media.episodes[epKey]) {
            media.episodes[epKey] = { season, episode, count: 0 };
        }
        media.episodes[epKey].count = segmentCount;
    }

    media.totalSegments = Object.keys(media.episodes || {}).length;
    media.lastUpdated = new Date().toISOString();

    await writeCatalogEntry(imdbId, media);
}

async function updateCatalog(segment) {
    return await registerShow(segment.videoId);
}

async function getCatalogData(page = 1, limit = 1000) {
    await ensureInit();
    const skip = (page - 1) * limit;

    if (useMongo) {
        // Filter at DB level for performance
        // Only show items that have segments to avoid empty catalog rows
        const query = {
            title: { $nin: [null, 'null', 'undefined', 'Unknown Title', ''] },
            year: { $nin: [null, '????', ''] },
            totalSegments: { $gt: 0 }
        };

        const total = await catalogCollection.countDocuments(query);
        const items = await catalogCollection.find(query)
            .sort({ lastUpdated: -1 })
            .skip(skip)
            .limit(limit)
            .toArray();

        const media = {};
        items.forEach(item => {
            const { _id, ...rest } = item;
            media[item.imdbId] = rest;
        });

        return {
            lastUpdated: new Date().toISOString(),
            media,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit)
            }
        };
    }

    // Fallback for local JSON
    const data = await readCatalog();
    if (data.media) {
        const entries = Object.entries(data.media).filter(([id, item]) => {
            const hasTitle = item.title && item.title !== 'null' && item.title !== 'undefined' && item.title !== 'Unknown Title';
            const hasYear = item.year && item.year !== '????';
            return hasTitle && hasYear;
        });

        const total = entries.length;
        const pagedEntries = entries
            .sort((a, b) => new Date(b[1].lastUpdated) - new Date(a[1].lastUpdated))
            .slice(skip, skip + limit);

        const media = Object.fromEntries(pagedEntries);

        return {
            lastUpdated: data.lastUpdated,
            media,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit)
            }
        };
    }
    return data;
}

async function getCatalogStats() {
    const now = Date.now();
    // Cache for 60 seconds
    if (statsCache && (now - lastStatsTime < 60000)) {
        return statsCache;
    }

    await ensureInit();
    let showCount = 0;
    let episodeCount = 0;

    if (useMongo) {
        const query = {
            title: { $nin: [null, 'null', 'undefined', 'Unknown Title', ''] },
            year: { $nin: [null, '????', ''] }
        };
        showCount = await catalogCollection.countDocuments(query);

        // Simplified episode count for Mongo (total of all episode keys)
        const result = await catalogCollection.aggregate([
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
        episodeCount = result[0]?.total || 0;
    } else {
        const data = await readCatalog();
        if (data.media) {
            const entries = Object.values(data.media).filter(item => {
                return item.title && item.title !== 'null' && item.title !== 'undefined' && item.title !== 'Unknown Title' && item.year !== '????';
            });
            showCount = entries.length;
            entries.forEach(item => {
                episodeCount += Object.keys(item.episodes || {}).length;
            });
        }
    }

    statsCache = { showCount, episodeCount };
    lastStatsTime = now;
    return statsCache;
}

async function repairCatalog(allSkips) {
    if (!allSkips) return;

    const skipKeys = Object.keys(allSkips);
    console.log(`[Catalog] Running catalog repair/sync from ${skipKeys.length} items...`);

    // SAFETY CHECK: If the source of truth is tiny but we suspect it should be large, abort.
    // This prevents wiping the catalog if skipService fails to load but somehow returns an empty map.
    if (skipKeys.length < 50) {
        console.warn('[Catalog] Aborting repair: Source of truth looks too small. Is DB connected?');
        return;
    }

    let changes = 0;
    const showMap = {}; // imdbId -> { epKey -> count }

    // 1. Rebuild Episode Maps from Skips
    for (const fullId of skipKeys) {
        const parts = fullId.split(':');
        if (parts.length < 3) continue;

        const imdbId = parts[0];
        const season = parseInt(parts[1]);
        const episode = parseInt(parts[2]);
        const epKey = `${season}:${episode}`;

        if (!showMap[imdbId]) showMap[imdbId] = {};
        showMap[imdbId][epKey] = (showMap[imdbId][epKey] || 0) + 1;
    }

    // 2. Sync Rebuilt Data to Catalog
    // We iterate the showMap (which came from Skips) to ensure all shows with segments exist.
    for (const [imdbId, episodes] of Object.entries(showMap)) {
        try {
            await registerShowV2(imdbId + ":1:1", 0); // Ensure show exists (dummy ep update)

            // Now fetch it and update all episodes
            const catalog = await readCatalog();
            const media = catalog.media[imdbId];
            if (media) {
                media.episodes = {}; // Reset before rebuild
                for (const [epKey, count] of Object.entries(episodes)) {
                    const [s, e] = epKey.split(':').map(Number);
                    media.episodes[epKey] = { season: s, episode: e, count };
                }
                media.totalSegments = Object.keys(media.episodes).length;
                media.lastUpdated = new Date().toISOString();

                await writeCatalogEntry(imdbId, media);
                changes++;
            }
        } catch (e) {
            console.error(`[Catalog] Failed to sync ${imdbId}:`, e.message);
        }
    }

    console.log(`[Catalog] Rebuilt/Synced ${changes} shows.`);
}

module.exports = {
    updateCatalog,
    registerShow,
    getCatalogData,
    repairCatalog,
    getCatalogStats
};

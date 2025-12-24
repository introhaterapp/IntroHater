const axios = require('axios');
const path = require('path');
const fs = require('fs').promises;
const catalogRepository = require('../repositories/catalog.repository');

async function ensureInit() {
    await catalogRepository.ensureInit();
}

async function readCatalog() {
    await ensureInit();
    if (catalogRepository.useMongo) {
        const items = await catalogRepository.find({});
        const media = {};
        items.forEach(item => {
            const { _id, ...rest } = item;
            media[item.imdbId] = rest;
        });
        return { lastUpdated: new Date().toISOString(), media };
    }
    // Fallback to local file if Mongo not available (legacy)
    try {
        const CATALOG_FILE = path.join(__dirname, '../../data/catalog.json');
        const data = await fs.readFile(CATALOG_FILE, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        return { lastUpdated: null, media: {} };
    }
}

async function writeCatalogEntry(imdbId, entry) {
    await ensureInit();
    if (catalogRepository.useMongo) {
        await catalogRepository.upsertCatalogEntry(imdbId, entry);
    } else {
        try {
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

async function registerShow(videoId) {
    const parts = videoId.split(':');
    const imdbId = parts[0];

    if (!imdbId.match(/^tt\d+$/)) {
        console.warn(`[Catalog] Rejected invalid ID: ${imdbId}`);
        return;
    }

    const season = parts[1] ? parseInt(parts[1]) : null;
    const episode = parts[2] ? parseInt(parts[2]) : null;

    await ensureInit();
    let media = null;
    if (catalogRepository.useMongo) {
        media = await catalogRepository.findByImdbId(imdbId);
    } else {
        const catalog = await readCatalog();
        media = catalog.media[imdbId];
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
        if (!media.episodes[epKey]) {
            media.episodes[epKey] = {
                season, episode, count: 0
            };
        }
        media.episodes[epKey].count++;
    }

    media.totalSegments = Object.keys(media.episodes || {}).length;
    media.lastUpdated = new Date().toISOString();

    await writeCatalogEntry(imdbId, media);
}

async function registerShowV2(videoId, segmentCount = 1) {
    const parts = videoId.split(':');
    const imdbId = parts[0];
    const season = parts[1] ? parseInt(parts[1]) : null;
    const episode = parts[2] ? parseInt(parts[2]) : null;

    if (!imdbId.match(/^tt\d+$/)) return;

    await ensureInit();
    let media = null;
    if (catalogRepository.useMongo) {
        media = await catalogRepository.findByImdbId(imdbId);
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

async function getCatalogData(page = 1, limit = 1000, search = '', sort = { title: 1 }) {
    await ensureInit();
    const skip = (page - 1) * limit;

    if (catalogRepository.useMongo) {
        const query = {
            title: { $nin: [null, 'null', 'undefined', 'Unknown Title', ''] },
            year: { $nin: [null, '????', ''] },
            totalSegments: { $gt: 0 }
        };

        const { items, total, filteredTotal } = await catalogRepository.getCatalogData(query, skip, limit, search, sort);

        const media = {};
        items.forEach(item => {
            const { _id, ...rest } = item;
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

    // Fallback for local JSON
    const data = await readCatalog();
    if (data.media) {
        let entries = Object.entries(data.media).filter(([id, item]) => {
            const hasTitle = item.title && item.title !== 'null' && item.title !== 'undefined' && item.title !== 'Unknown Title';
            const hasYear = item.year && item.year !== '????';
            const matchesSearch = !search ||
                (item.title && item.title.toLowerCase().includes(search.toLowerCase())) ||
                id.toLowerCase().includes(search.toLowerCase());
            return hasTitle && hasYear && matchesSearch;
        });

        const total = Object.keys(data.media).length;
        const filteredTotal = entries.length;

        const pagedEntries = entries
            .sort((a, b) => {
                // Basic sort for fallback
                const field = Object.keys(sort)[0] || 'title';
                const dir = sort[field] || 1;
                const valA = a[1][field] || '';
                const valB = b[1][field] || '';
                return dir === 1 ? valA.localeCompare(valB) : valB.localeCompare(valA);
            })
            .slice(skip, skip + limit);

        const media = Object.fromEntries(pagedEntries);

        return {
            lastUpdated: data.lastUpdated,
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
    return data;
}

async function getCatalogStats() {
    // We could keep the cache in the repository if we want, but let's keep it here for now if needed.
    // However, the repository aggregate is fast enough.

    await ensureInit();
    if (catalogRepository.useMongo) {
        const query = {
            title: { $nin: [null, 'null', 'undefined', 'Unknown Title', ''] },
            year: { $nin: [null, '????', ''] }
        };
        return await catalogRepository.getCatalogStats(query);
    } else {
        const data = await readCatalog();
        let showCount = 0;
        let episodeCount = 0;
        if (data.media) {
            const entries = Object.values(data.media).filter(item => {
                return item.title && item.title !== 'null' && item.title !== 'undefined' && item.title !== 'Unknown Title' && item.year !== '????';
            });
            showCount = entries.length;
            entries.forEach(item => {
                episodeCount += Object.keys(item.episodes || {}).length;
            });
        }
        return { showCount, episodeCount };
    }
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

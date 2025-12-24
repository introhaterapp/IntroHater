const fs = require('fs').promises;
const path = require('path');
const skipRepository = require('../repositories/skip.repository');
const axios = require('axios');
const catalogService = require('./catalog');

const DATA_FILE = path.join(__dirname, '../data/skips.json');

// In-memory cache (Fallback)
let skipsData = {}; // Format: { "imdb:s:e": [ { start, end, label, votes } ] }

const MAL_CACHE_FILE = path.join(__dirname, '../../data/mal_cache.json');
const SKIP_CACHE_FILE = path.join(__dirname, '../../data/third_party_skip_cache.json');

let MAL_CACHE = {}; // Cache for Aniskip Mapping
let SKIP_CACHE = {}; // Cache for Aniskip Results

async function loadCache() {
    try {
        const malData = await fs.readFile(MAL_CACHE_FILE, 'utf8');
        MAL_CACHE = JSON.parse(malData);
        console.log(`[SkipService] Loaded ${Object.keys(MAL_CACHE).length} MAL mappings.`);
    } catch (e) { }

    try {
        const skipData = await fs.readFile(SKIP_CACHE_FILE, 'utf8');
        SKIP_CACHE = JSON.parse(skipData);
        console.log(`[SkipService] Loaded ${Object.keys(SKIP_CACHE).length} third-party skip segments from cache.`);
    } catch (e) { }
}

async function saveCache() {
    try {
        await fs.mkdir(path.dirname(MAL_CACHE_FILE), { recursive: true });
        await fs.writeFile(MAL_CACHE_FILE, JSON.stringify(MAL_CACHE, null, 2));
        await fs.writeFile(SKIP_CACHE_FILE, JSON.stringify(SKIP_CACHE, null, 2));
    } catch (e) {
        console.error("[SkipService] Cache Save Error:", e.message);
    }
}

// Initialize
let initPromise = null;

function ensureInit() {
    if (initPromise) return initPromise;

    initPromise = (async () => {
        try {
            console.log('[SkipService] Initializing...');
            await skipRepository.ensureInit();

            if (!skipRepository.useMongo) {
                console.log('[SkipService] MongoDB not available. Using local JSON.');
                await loadSkips();
            }
            await loadCache();
        } catch (e) {
            console.error("[SkipService] Init Error:", e);
            await loadSkips();
            await loadCache();
        }
    })();

    return initPromise;
}

// Trigger early - REMOVED for lazy init
// ensureInit();

async function loadSkips() {
    try {
        const data = await fs.readFile(DATA_FILE, 'utf8');
        skipsData = JSON.parse(data);
        console.log(`[SkipService] Loaded ${Object.keys(skipsData).length} shows from local DB.`);
    } catch (error) {
        if (error.code === 'ENOENT') {
            skipsData = {};
        } else {
            console.error('[SkipService] Error loading data:', error);
        }
    }
}

async function saveSkips() {
    try {
        const dir = path.dirname(DATA_FILE);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(DATA_FILE, JSON.stringify(skipsData, null, 4));
    } catch (error) {
        console.error('[SkipService] Error saving data:', error);
    }
}

// --- Helpers ---

function escapeRegex(string) {
    return string.replace(/[/\-\\^$*+?.()|[\]{}]/g, '\\$&');
}

// Get all segments for a specific video ID
// Get all segments for a specific video ID
async function getSegments(fullId) {
    await ensureInit();

    const cleanId = String(fullId).trim();
    let segments = [];
    const isSeriesRequest = !cleanId.includes(':');

    if (skipRepository.useMongo) {
        try {
            if (isSeriesRequest) {
                // Optimization: Use seriesId instead of regex
                const docs = await skipRepository.findBySeriesId(cleanId);
                docs.forEach(doc => {
                    if (doc.segments) {
                        const epSegments = doc.segments.map(s => ({ ...s, videoId: doc.fullId }));
                        segments.push(...epSegments);
                    }
                });
            } else {
                let doc = await skipRepository.findByFullId(cleanId);
                if (!doc) {
                    doc = await skipRepository.findByFullIdRegex(`^${escapeRegex(cleanId)}$`, 'i');
                }
                if (doc) segments = doc.segments || [];
            }

            const parts = cleanId.split(':');
            if (parts.length >= 3) {
                const seriesId = parts[0];
                const seriesDoc = await skipRepository.findByFullId(seriesId);
                if (seriesDoc && seriesDoc.segments) {
                    const seriesSkips = seriesDoc.segments.filter(s => s.seriesSkip);
                    if (seriesSkips.length > 0) {
                        console.log(`[SkipService] Found ${seriesSkips.length} GLOBAL SERIES skips for [${cleanId}]`);
                        const formatted = seriesSkips.map(s => ({ ...s, videoId: cleanId }));
                        segments = [...segments, ...formatted];
                    }
                }
            }
        } catch (e) {
            console.error("[SkipService] Repository Query Error:", e.message);
            return [];
        }
    } else {
        // ... (local JSON logic remains similar or uses keys)
        if (isSeriesRequest) {
            for (const key in skipsData) {
                if (key.startsWith(`${cleanId}:`)) {
                    const epSegments = skipsData[key].map(s => ({ ...s, videoId: key }));
                    segments.push(...epSegments);
                }
            }
        } else {
            segments = skipsData[cleanId] || [];
            if (segments.length > 0 && !segments[0].videoId) {
                segments = segments.map(s => ({ ...s, videoId: cleanId }));
            }
            const parts = cleanId.split(':');
            if (parts.length >= 3) {
                const seriesId = parts[0];
                if (skipsData[seriesId]) {
                    const seriesSkips = skipsData[seriesId].filter(s => s.seriesSkip);
                    if (seriesSkips.length > 0) {
                        const formatted = seriesSkips.map(s => ({ ...s, videoId: cleanId }));
                        segments = [...segments, ...formatted];
                    }
                }
            }
        }
    }

    if (segments.length > 0 && !isSeriesRequest) {
        console.log(`[SkipService] Found ${segments.length} segments total for [${cleanId}] before merge`);
    }

    return mergeSegments(segments);
}

// Helper: Merge overlapping or adjacent segments
function mergeSegments(segments) {
    if (!segments || segments.length === 0) return [];

    // Round values for consistency before merging
    const processed = segments.map(seg => ({
        ...seg,
        start: Math.round(seg.start),
        end: Math.round(seg.end)
    }));

    // Sort by videoId THEN start time
    const sorted = [...processed].sort((a, b) => {
        if (a.videoId < b.videoId) return -1;
        if (a.videoId > b.videoId) return 1;
        return a.start - b.start;
    });

    const merged = [];
    let current = sorted[0];

    for (let i = 1; i < sorted.length; i++) {
        const next = sorted[i];

        if (current.videoId !== next.videoId) {
            merged.push(current);
            current = next;
            continue;
        }

        // Check for overlap or adjacency (within 1 second)
        if (next.start <= (current.end + 1)) {
            current.end = Math.max(current.end, next.end);
            // Label prioritization: Prefer 'Intro' over 'Common'
            if (next.label === 'Intro' && current.label !== 'Intro') {
                current.label = 'Intro';
            }
        } else {
            merged.push(current);
            current = next;
        }
    }
    merged.push(current);

    return merged;
}

// Get total count of segments across all episodes
async function getSegmentCount() {
    await ensureInit();
    if (skipRepository.useMongo) {
        try {
            const t = Date.now();
            const result = await skipRepository.getGlobalStats();
            console.log(`[SkipService] Repository segment count aggregation took ${Date.now() - t}ms`);
            return result[0]?.total || 0;
        } catch (e) {
            console.error("[SkipService] Aggregate Count Error:", e.message);
            return 0;
        }
    }
    return Object.values(skipsData).flat().length;
}

async function getAllSegments() {
    await ensureInit();
    if (skipRepository.useMongo) {
        const allDocs = await skipRepository.find({});
        const map = {};
        allDocs.forEach(d => map[d.fullId] = d.segments);
        return map;
    }
    return skipsData;
}

// --- Aniskip Integration ---

async function getMalId(imdbId) {
    if (MAL_CACHE[imdbId]) return MAL_CACHE[imdbId];

    try {
        const metaRes = await axios.get(`https://v3-cinemeta.strem.io/meta/series/${imdbId}.json`);
        const name = metaRes.data?.meta?.name;
        if (!name) return null;

        console.log(`[SkipService] Searching MAL ID for "${name}"...`);
        const jikanRes = await axios.get(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(name)}&type=tv&limit=1`);

        if (jikanRes.data?.data?.[0]?.mal_id) {
            const malId = jikanRes.data.data[0].mal_id;
            console.log(`[SkipService] Mapped ${imdbId} (${name}) -> MAL ${malId}`);
            MAL_CACHE[imdbId] = malId;
            saveCache().catch(() => { }); // Persist
            return malId;
        }
    } catch (e) {
        console.error(`[SkipService] Mapping failed for ${imdbId}: ${e.message}`);
    }
    return null;
}

async function fetchAniskip(malId, episode) {
    const cacheKey = `${malId}:${episode}`;
    if (SKIP_CACHE[cacheKey]) return SKIP_CACHE[cacheKey];

    try {
        const url = `https://api.aniskip.com/v2/skip-times/${malId}/${episode}?types[]=op&types[]=ed&episodeLength=0`;
        const res = await axios.get(url);
        if (res.data.found && res.data.results) {
            const op = res.data.results.find(r => r.skipType === 'op');
            if (op && op.interval) {
                const result = {
                    start: op.interval.startTime,
                    end: op.interval.endTime,
                    label: 'Intro',
                    source: 'aniskip'
                };
                SKIP_CACHE[cacheKey] = result;
                return result;
            }
        }
    } catch (e) { }

    // Cache null to stop hammering for 404s
    SKIP_CACHE[cacheKey] = null;
    saveCache().catch(() => { });
    return null;
}

const ANIME_SKIP_CLIENT_ID = 'th2oogUKrgOf1J8wMSIUPV0IpBMsLOJi';

async function fetchAnimeSkip(malId, episode, imdbId) {
    const cacheKey = `as:${malId || imdbId}:${episode}`;
    if (SKIP_CACHE[cacheKey]) return SKIP_CACHE[cacheKey];

    try {
        let showId = null;

        // 1. If we have a malId, we could try findShowsByExternalId, 
        // but searchShows by name is often more reliable for matching Anime-Skip's DB
        // Let's try to get the name from Cinemeta first if we only have imdbId
        let name = null;
        if (imdbId) {
            try {
                const metaRes = await axios.get(`https://v3-cinemeta.strem.io/meta/series/${imdbId}.json`);
                name = metaRes.data?.meta?.name;
            } catch (e) { }
        }

        if (name) {
            console.log(`[SkipService] Anime-Skip: Searching for "${name}"`);
            const searchRes = await axios.post('https://api.anime-skip.com/graphql', {
                query: `query ($search: String!) { searchShows(search: $search) { id name } }`,
                variables: { search: name }
            }, { headers: { 'X-Client-ID': ANIME_SKIP_CLIENT_ID } });

            const shows = searchRes.data?.data?.searchShows;
            if (shows && shows.length > 0) {
                // Try to find exact match or just take the first
                const match = shows.find(s => s.name.toLowerCase() === name.toLowerCase()) || shows[0];
                showId = match.id;
                console.log(`[SkipService] Anime-Skip: Found show "${match.name}" (${showId})`);
            }
        }

        if (!showId) {
            SKIP_CACHE[cacheKey] = null;
            return null;
        }

        // 2. Fetch timestamps for the show
        const query = `
            query ($showId: ID!, $episodeNumber: Float!) {
                findEpisodesByShowId(showId: $showId) {
                    number
                    timestamps {
                        at
                        type {
                            name
                        }
                    }
                }
            }
        `;

        const res = await axios.post('https://api.anime-skip.com/graphql', {
            query,
            variables: { showId, episodeNumber: parseFloat(episode) }
        }, {
            headers: { 'X-Client-ID': ANIME_SKIP_CLIENT_ID }
        });

        const episodes = res.data?.data?.findEpisodesByShowId || [];
        const episodeData = episodes.find(e => e.number === parseFloat(episode));

        if (episodeData && episodeData.timestamps) {
            const timestamps = episodeData.timestamps;
            const introStart = timestamps.find(t => t.type.name.toLowerCase().includes('opening') || t.type.name.toLowerCase().includes('intro'));

            if (introStart) {
                const currentIndex = timestamps.indexOf(introStart);
                const next = timestamps[currentIndex + 1];

                const result = {
                    start: introStart.at,
                    end: next ? next.at : introStart.at + 90,
                    label: 'Intro',
                    source: 'anime-skip'
                };

                SKIP_CACHE[cacheKey] = result;
                return result;
            }
        }
    } catch (e) {
        console.error(`[SkipService] Anime-Skip fetch failed: ${e.message}`);
    }

    SKIP_CACHE[cacheKey] = null;
    saveCache().catch(() => { });
    return null;
}


// --- Main Lookup Logic ---

async function getSkipSegment(fullId) {
    // 1. Check DB (Local or Mongo)
    const segments = await getSegments(fullId);
    if (segments && segments.length > 0) {
        // Find best intro
        const intro = segments.find(s => s.label === 'Intro' || s.label === 'OP');
        if (intro) {
            // Also ensure it's in catalog as local source
            catalogService.registerShow(fullId).catch(() => { });
            return { start: intro.start, end: intro.end, source: intro.source || 'community' };
        }
    }

    // 2. Parsed ID Check for Aniskip fallback
    const parts = fullId.split(':');
    if (parts.length >= 3) {
        const imdbId = parts[0];
        const episode = parseInt(parts[2]);

        // 3. Try Aniskip
        const malId = await getMalId(imdbId);
        if (malId) {
            const aniSkip = await fetchAniskip(malId, episode);
            if (aniSkip) {
                console.log(`[SkipService] Found Aniskip for ${fullId}: ${aniSkip.start}-${aniSkip.end}`);
                // Persist the segment (Fire and forget, don't await)
                addSkipSegment(fullId, aniSkip.start, aniSkip.end, 'Intro', 'aniskip')
                    .catch(e => console.error(`[SkipService] Failed to persist Aniskip segment: ${e.message}`));

                // Register in catalog
                catalogService.registerShow(fullId).catch(() => { });

                return aniSkip;
            }

            // 4. Try Anime-Skip (Fallback)
            const animeSkip = await fetchAnimeSkip(malId, episode, imdbId);
            if (animeSkip) {
                console.log(`[SkipService] Found Anime-Skip for ${fullId}: ${animeSkip.start}-${animeSkip.end}`);
                // Persist the segment
                addSkipSegment(fullId, animeSkip.start, animeSkip.end, 'Intro', 'anime-skip')
                    .catch(e => console.error(`[SkipService] Failed to persist Anime-Skip segment: ${e.message}`));

                // Register in catalog
                catalogService.registerShow(fullId).catch(() => { });

                return animeSkip;
            }
        }
    }

    return null;
}

// --- Write Operations (Crowdsourcing) ---

async function addSkipSegment(fullId, start, end, label = "Intro", userId = "anonymous", applyToSeries = false, skipSave = false) {
    await ensureInit();
    const TRUSTED_SOURCES = ['aniskip', 'anime-skip', 'auto-import', 'chapter-bot'];
    const isTrusted = TRUSTED_SOURCES.includes(userId);

    if (typeof start !== 'number' || typeof end !== 'number' || start < 0 || end <= start) {
        throw new Error("Invalid start or end times");
    }
    if (end > 36000) {
        throw new Error("Segment too long or beyond reasonable bounds");
    }
    const cleanLabel = String(label).substring(0, 50);
    let cleanFullId = String(fullId).substring(0, 255);
    let seriesId = null;

    const parts = cleanFullId.split(':');
    if (parts.length >= 3) {
        seriesId = parts[0];
    }

    if (applyToSeries) {
        if (seriesId) {
            cleanFullId = seriesId;
        }
    }

    const existingSegments = await getSegments(cleanFullId);
    if (existingSegments && existingSegments.length > 0) {
        const isDuplicate = existingSegments.some(s => {
            return Math.abs(s.start - start) < 1.0 &&
                Math.abs(s.end - end) < 1.0;
        });

        if (isDuplicate) {
            return existingSegments.find(s => Math.abs(s.start - start) < 1.0);
        }
    }

    const newSegment = {
        start, end, label: cleanLabel,
        votes: 1,
        verified: isTrusted,
        source: userId === 'aniskip' ? 'aniskip' : 'user',
        reportCount: 0,
        seriesSkip: applyToSeries === true,
        contributors: [userId],
        createdAt: new Date().toISOString()
    };

    if (skipRepository.useMongo) {
        await skipRepository.addSegment(cleanFullId, newSegment, seriesId);
    } else {
        if (!skipsData[cleanFullId]) skipsData[cleanFullId] = [];
        skipsData[cleanFullId].push(newSegment);

        if (!skipSave) {
            await saveSkips();
        }
    }

    catalogService.registerShow(cleanFullId).catch(() => { });

    return newSegment;
}

// --- Maintenance ---
async function approveAllTrusted() {
    await ensureInit();
    console.log('[SkipService] Running trusted source auto-approval...');
    const TRUSTED_SOURCES = ['aniskip', 'anime-skip', 'auto-import', 'chapter-bot'];
    let count = 0;

    if (skipRepository.useMongo) {
        const allDocs = await skipRepository.find({});
        for (const doc of allDocs) {
            let changed = false;
            if (doc.segments && Array.isArray(doc.segments)) {
                for (const seg of doc.segments) {
                    if (!seg.verified && seg.contributors && seg.contributors.some(c => TRUSTED_SOURCES.includes(c))) {
                        seg.verified = true;
                        changed = true;
                        count++;
                    }
                }
            }
            if (changed) {
                await skipRepository.updateSegments(doc.fullId, doc.segments);
            }
        }
    } else {
        for (const fullId in skipsData) {
            const segments = skipsData[fullId];
            if (Array.isArray(segments)) {
                for (const seg of segments) {
                    if (!seg.verified && seg.contributors && seg.contributors.some(c => TRUSTED_SOURCES.includes(c))) {
                        seg.verified = true;
                        count++;
                    }
                }
            }
        }
        if (count > 0) await saveSkips();
    }
    console.log(`[SkipService] Auto-approved ${count} existing trusted segments.`);
}

// Run approval on startup (fire and forget)
setTimeout(approveAllTrusted, 5000);

async function forceSave() {
    if (!skipRepository.useMongo) {
        await saveSkips();
    }
}

// --- Admin Operations ---

// --- Admin Operations ---

async function getPendingModeration() {
    await ensureInit();
    const pending = [];
    const reported = [];

    if (skipRepository.useMongo) {
        try {
            const docs = await skipRepository.getPendingModeration();

            docs.forEach(doc => {
                if (doc.segments) {
                    doc.segments.forEach((seg, index) => {
                        if (!seg.verified) {
                            pending.push({ fullId: doc.fullId, index, ...seg });
                        }
                        if (seg.reportCount > 0) {
                            reported.push({ fullId: doc.fullId, index, ...seg });
                        }
                    });
                }
            });
        } catch (e) {
            console.error("[SkipService] Error fetching pending moderation:", e);
        }
    } else {
        // Fallback for local JSON (Scan everything)
        const allSkips = await getAllSegments();
        for (const [fullId, segments] of Object.entries(allSkips)) {
            segments.forEach((seg, index) => {
                if (!seg.verified) {
                    pending.push({ fullId, index, ...seg });
                }
                if (seg.reportCount > 0) {
                    reported.push({ fullId, index, ...seg });
                }
            });
        }
    }

    return { pending, reported };
}

async function resolveModerationBulk(items, action) {
    if (!items || !Array.isArray(items) || items.length === 0) return 0;
    await ensureInit();

    // Group by fullId to minimize DB operations and handle multiple updates per doc safely
    const grouped = {};
    for (const item of items) {
        if (!grouped[item.fullId]) grouped[item.fullId] = [];
        grouped[item.fullId].push(item.index);
    }

    let modifiedCount = 0;

    for (const fullId in grouped) {
        const indices = grouped[fullId].sort((a, b) => a - b); // Ascending order
        const indicesSet = new Set(indices);

        if (skipRepository.useMongo) {
            const doc = await skipRepository.findByFullId(fullId);
            if (!doc || !doc.segments) continue;

            let changed = false;
            // Filter or Modify
            if (action === 'delete') {
                const originalLength = doc.segments.length;
                doc.segments = doc.segments.filter((_, i) => !indicesSet.has(i));
                if (doc.segments.length !== originalLength) changed = true;
            } else if (action === 'approve') {
                indices.forEach(i => {
                    if (doc.segments[i]) {
                        doc.segments[i].verified = true;
                        doc.segments[i].reportCount = 0;
                        changed = true;
                    }
                });
            }

            if (changed) {
                await skipRepository.updateSegments(fullId, doc.segments);
                modifiedCount += indices.length;
            }
        } else {
            // Local JSON
            if (!skipsData[fullId]) continue;
            const segments = skipsData[fullId];
            let changed = false;

            if (action === 'delete') {
                const originalLength = segments.length;
                skipsData[fullId] = segments.filter((_, i) => !indicesSet.has(i));
                if (skipsData[fullId].length !== originalLength) changed = true;
            } else if (action === 'approve') {
                indices.forEach(i => {
                    if (segments[i]) {
                        segments[i].verified = true;
                        segments[i].reportCount = 0;
                        changed = true;
                    }
                });
            }

            if (changed) modifiedCount += indices.length;
        }
    }

    if (!useMongo && modifiedCount > 0) {
        await saveSkips();
    }

    return modifiedCount;
}

async function resolveModeration(fullId, index, action) {
    await ensureInit();
    if (skipRepository.useMongo) {
        const doc = await skipRepository.findByFullId(fullId);
        if (!doc || !doc.segments[index]) return false;

        if (action === 'approve') {
            doc.segments[index].verified = true;
            doc.segments[index].reportCount = 0;
        } else if (action === 'delete') {
            doc.segments.splice(index, 1);
        }

        await skipRepository.updateSegments(fullId, doc.segments);
    } else {
        if (!skipsData[fullId] || !skipsData[fullId][index]) return false;

        if (action === 'approve') {
            skipsData[fullId][index].verified = true;
            skipsData[fullId][index].reportCount = 0;
        } else if (action === 'delete') {
            skipsData[fullId].splice(index, 1);
        }
        await saveSkips();
    }
    return true;
}

async function reportSegment(fullId, index) {
    await ensureInit();
    if (skipRepository.useMongo) {
        const doc = await skipRepository.findByFullId(fullId);
        if (!doc || !doc.segments[index]) return false;
        doc.segments[index].reportCount = (doc.segments[index].reportCount || 0) + 1;
        await skipRepository.updateSegments(fullId, doc.segments);
    } else {
        if (!skipsData[fullId] || !skipsData[fullId][index]) return false;
        skipsData[fullId][index].reportCount = (skipsData[fullId][index].reportCount || 0) + 1;
        await saveSkips();
    }
    return true;
}


async function cleanupDuplicates() {
    await ensureInit();
    console.log('[SkipService] Starting duplicate cleanup...');
    let totalRemoved = 0;
    let showsEncoded = 0;

    const processSegments = (segments) => {
        if (!segments || segments.length < 2) return { cleaned: segments, removed: 0 };

        const unique = [];
        let removedCount = 0;

        // Sort by start time to keep it deterministic
        segments.sort((a, b) => a.start - b.start);

        for (const seg of segments) {
            // Check if this segment is effectively a duplicate of one we already kept
            const isDup = unique.some(u =>
                Math.abs(u.start - seg.start) < 1.0 &&
                Math.abs(u.end - seg.end) < 1.0
            );

            if (isDup) {
                removedCount++;
            } else {
                unique.push(seg);
            }
        }
        return { cleaned: unique, removed: removedCount };
    };

    if (useMongo && skipsCollection) {
        const cursor = skipsCollection.find({});
        while (await cursor.hasNext()) {
            const doc = await cursor.next();
            const { cleaned, removed } = processSegments(doc.segments);

            if (removed > 0) {
                await skipsCollection.updateOne({ _id: doc._id }, { $set: { segments: cleaned } });
                totalRemoved += removed;
                showsEncoded++;
            }
        }
    } else {
        for (const fullId in skipsData) {
            const { cleaned, removed } = processSegments(skipsData[fullId]);
            if (removed > 0) {
                skipsData[fullId] = cleaned;
                totalRemoved += removed;
                showsEncoded++;
            }
        }
        if (totalRemoved > 0) await saveSkips();
    }

    console.log(`[SkipService] Cleanup complete. Removed ${totalRemoved} duplicates across ${showsEncoded} shows.`);
    return totalRemoved;
}

module.exports = {
    getSkipSegment,
    getSegments,
    getAllSegments,
    getSegmentCount,
    addSkipSegment,
    cleanupDuplicates,
    getPendingModeration,
    resolveModeration,
    resolveModerationBulk,
    reportSegment,
    forceSave
};

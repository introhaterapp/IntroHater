const fs = require('fs').promises;
const path = require('path');
const mongoService = require('./mongodb');
const axios = require('axios');
const catalogService = require('./catalog');

const DATA_FILE = path.join(__dirname, '../data/skips.json');

// In-memory cache (Fallback)
let skipsData = {}; // Format: { "imdb:s:e": [ { start, end, label, votes } ] }

// Persistence State
let useMongo = false;
let skipsCollection = null;
const MAL_CACHE = {}; // Cache for Aniskip Mapping
const SKIP_CACHE = {}; // Cache for Aniskip Results

// Initialize
let initPromise = null;

function ensureInit() {
    if (initPromise) return initPromise;

    initPromise = (async () => {
        try {
            console.log('[SkipService] Initializing...');
            skipsCollection = await mongoService.getCollection('skips');

            if (skipsCollection) {
                useMongo = true;
                const count = await skipsCollection.countDocuments();
                console.log(`[SkipService] Connected to MongoDB skips collection (${count} documents).`);
                try {
                    await skipsCollection.createIndex({ fullId: 1 }, { unique: true });
                } catch (e) { /* Index might already exist */ }
            } else {
                console.log('[SkipService] MongoDB not available. Using local JSON.');
                await loadSkips();
            }
        } catch (e) {
            console.error("[SkipService] Init Error:", e);
            await loadSkips();
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
async function getSegments(fullId) {
    await ensureInit();

    const cleanId = String(fullId).trim();
    let segments = [];

    if (useMongo && skipsCollection) {
        try {
            // 1. Try Exact Match (Episode Level)
            let doc = await skipsCollection.findOne({ fullId: cleanId });

            // 2. Try Case-Insensitive Match (Regex)
            if (!doc) {
                const escapedId = escapeRegex(cleanId);
                doc = await skipsCollection.findOne({
                    fullId: { $regex: `^${escapedId}$`, $options: 'i' }
                });
            }

            if (doc) segments = doc.segments || [];

            // 3. Check for Global Series Skips
            // If ID is in format tt123:1:2, check tt123
            const parts = cleanId.split(':');
            if (parts.length >= 3) {
                const seriesId = parts[0];
                const seriesDoc = await skipsCollection.findOne({ fullId: seriesId });
                if (seriesDoc && seriesDoc.segments) {
                    // Filter for series-wide skips only
                    const seriesSkips = seriesDoc.segments.filter(s => s.seriesSkip);
                    if (seriesSkips.length > 0) {
                        console.log(`[SkipService] Found ${seriesSkips.length} GLOBAL SERIES skips for [${cleanId}]`);
                        segments = [...segments, ...seriesSkips];
                    }
                }
            }

        } catch (e) {
            console.error("[SkipService] Mongo Query Error:", e.message);
            return [];
        }
    } else {
        segments = skipsData[cleanId] || [];

        // Check local series skips
        const parts = cleanId.split(':');
        if (parts.length >= 3) {
            const seriesId = parts[0];
            if (skipsData[seriesId]) {
                const seriesSkips = skipsData[seriesId].filter(s => s.seriesSkip);
                if (seriesSkips.length > 0) {
                    segments = [...segments, ...seriesSkips];
                }
            }
        }
    }

    if (segments.length > 0) {
        console.log(`[SkipService] Found ${segments.length} segments total for [${cleanId}]`);
    }

    return segments;
}

// Get all skips (Heavy operation - used for catalog)
async function getAllSegments() {
    await ensureInit();
    if (useMongo) {
        // Return object map key->segments to match original API
        const allDocs = await skipsCollection.find({}).toArray();
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
            return { start: intro.start, end: intro.end };
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

    // Input Validation
    if (typeof start !== 'number' || typeof end !== 'number' || start < 0 || end <= start) {
        throw new Error("Invalid start or end times");
    }
    if (end > 36000) { // Max 10 hours
        throw new Error("Segment too long or beyond reasonable bounds");
    }
    const cleanLabel = String(label).substring(0, 50); // Limit label length
    let cleanFullId = String(fullId).substring(0, 255);

    // If applying to series, strip to base ID
    if (applyToSeries) {
        const parts = cleanFullId.split(':');
        if (parts.length >= 3) {
            cleanFullId = parts[0]; // Use just the IMDb/Series ID
        }
    }

    const newSegment = {
        start, end, label: cleanLabel,
        votes: 1,
        verified: isTrusted, // Auto-verify trusted sources
        source: userId === 'aniskip' ? 'aniskip' : 'user',
        reportCount: 0,
        seriesSkip: applyToSeries === true, // Helper Flag
        contributors: [userId],
        createdAt: new Date().toISOString()
    };

    if (useMongo) {
        await skipsCollection.updateOne(
            { fullId: cleanFullId },
            { $push: { segments: newSegment } },
            { upsert: true }
        );
    } else {
        if (!skipsData[cleanFullId]) skipsData[cleanFullId] = [];
        skipsData[cleanFullId].push(newSegment);

        if (!skipSave) {
            await saveSkips();
        }
    }

    // Auto-register in catalog if it's a user submission (local)
    // For bulk import, we handle catalog registration separately in the indexer
    if (!isTrusted) {
        catalogService.registerShow(cleanFullId).catch(() => { });
    }

    return newSegment;
}

// --- Maintenance ---
async function approveAllTrusted() {
    await ensureInit();
    console.log('[SkipService] Running trusted source auto-approval...');
    const TRUSTED_SOURCES = ['aniskip', 'anime-skip', 'auto-import', 'chapter-bot'];
    let count = 0;

    if (useMongo && skipsCollection) {
        const cursor = skipsCollection.find({});
        while (await cursor.hasNext()) {
            const doc = await cursor.next();
            let changed = false;
            if (doc.segments && Array.isArray(doc.segments)) {
                // Refactored to for..of to avoid scope issues
                for (const seg of doc.segments) {
                    if (!seg.verified && seg.contributors && seg.contributors.some(c => TRUSTED_SOURCES.includes(c))) {
                        seg.verified = true;
                        changed = true;
                        count++;
                    }
                }
            }
            if (changed) {
                await skipsCollection.updateOne({ _id: doc._id }, { $set: { segments: doc.segments } });
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
    if (!useMongo) {
        await saveSkips();
    }
}

// --- Admin Operations ---

// --- Admin Operations ---

async function getPendingModeration() {
    await ensureInit();
    const allSkips = await getAllSegments();
    const pending = [];
    const reported = [];

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

    return { pending, reported };
}

async function resolveModeration(fullId, index, action) {
    await ensureInit();
    if (useMongo) {
        const doc = await skipsCollection.findOne({ fullId });
        if (!doc || !doc.segments[index]) return false;

        if (action === 'approve') {
            doc.segments[index].verified = true;
            doc.segments[index].reportCount = 0;
        } else if (action === 'delete') {
            doc.segments.splice(index, 1);
        }

        await skipsCollection.updateOne({ fullId }, { $set: { segments: doc.segments } });
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
    if (useMongo) {
        const doc = await skipsCollection.findOne({ fullId });
        if (!doc || !doc.segments[index]) return false;
        doc.segments[index].reportCount = (doc.segments[index].reportCount || 0) + 1;
        await skipsCollection.updateOne({ fullId }, { $set: { segments: doc.segments } });
    } else {
        if (!skipsData[fullId] || !skipsData[fullId][index]) return false;
        skipsData[fullId][index].reportCount = (skipsData[fullId][index].reportCount || 0) + 1;
        await saveSkips();
    }
    return true;
}

module.exports = {
    getSkipSegment,
    getSegments,
    getAllSegments,
    addSkipSegment,
    getPendingModeration,
    resolveModeration,
    reportSegment,
    forceSave
};

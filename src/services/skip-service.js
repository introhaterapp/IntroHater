const skipRepository = require('../repositories/skip.repository');
const cacheRepository = require('../repositories/cache.repository');
const axios = require('axios');
const catalogService = require('./catalog');
const { ANIME_SKIP } = require('../config/constants');

// Initialize
let initPromise = null;

async function ensureInit() {
    if (initPromise) return initPromise;

    initPromise = (async () => {
        try {
            console.log('[SkipService] Initializing Database-Only Storage...');
            await skipRepository.ensureInit();
            await cacheRepository.ensureInit();
        } catch (e) {
            console.error("[SkipService] Init Error:", e);
        }
    })();

    return initPromise;
}

// Trigger early
ensureInit();

// --- Helpers ---

function escapeRegex(string) {
    return string.replace(/[/\-\\^$*+?.()|[\]{}]/g, '\\$&');
}

/**
 * Get all segments for a specific video ID or Series.
 * Optimized to prefer denormalized catalog data.
 */
async function getSegments(fullId) {
    await ensureInit();

    const cleanId = String(fullId).trim();
    let segments = [];

    // Parse ID (e.g. tt123456:1:1)
    const parts = cleanId.split(':');
    const imdbId = parts[0];
    const isSeriesRequest = parts.length < 3;
    const epKey = !isSeriesRequest ? `${parts[1]}:${parts[2]}` : null;

    try {
        // 1. Try to fetch from Catalog first (Denormalized/Fast RAM Cache)
        const media = await catalogService.getShowByImdbId(imdbId);

        if (media && media.episodes) {
            if (isSeriesRequest) {
                // Return all segments for the series (flattened)
                for (const key in media.episodes) {
                    if (media.episodes[key].segments) {
                        const epSegments = media.episodes[key].segments.map(s => ({ ...s, videoId: `${imdbId}:${key}` }));
                        segments.push(...epSegments);
                    }
                }
            } else if (media.episodes[epKey] && media.episodes[epKey].segments) {
                // Return segments for specific episode
                segments = media.episodes[epKey].segments.map(s => ({ ...s, videoId: cleanId }));
            }

            if (segments.length > 0) {
                // Merge and return immediately if found in catalog
                return mergeSegments(segments);
            }
        }

        // 2. Fallback to SkipRepository (Cold DB fetch)
        if (isSeriesRequest) {
            const docs = await skipRepository.findBySeriesId(imdbId);
            const segmentsByEp = {};
            docs.forEach(doc => {
                if (doc.segments) {
                    const epSegments = doc.segments.map(s => ({ ...s, videoId: doc.fullId }));
                    segments.push(...epSegments);

                    const dParts = doc.fullId.split(':');
                    if (dParts.length >= 3) {
                        const dEpKey = `${dParts[1]}:${dParts[2]}`;
                        segmentsByEp[dEpKey] = doc.segments;
                    }
                }
            });

            // Trigger background bake for next time if we found data
            if (Object.keys(segmentsByEp).length > 0) {
                catalogService.bakeShowSegments(imdbId, segmentsByEp).catch(() => { });
            }
        } else {
            // Episode lookup
            const doc = await skipRepository.findByFullId(cleanId);
            if (doc && doc.segments) {
                segments = doc.segments.map(s => ({ ...s, videoId: cleanId }));
            }
        }

        // 3. Handle Series-Wide Skips (e.g. segments that apply to every episode)
        if (!isSeriesRequest) {
            const seriesDoc = await skipRepository.findByFullId(imdbId);
            if (seriesDoc && seriesDoc.segments) {
                const seriesSkips = seriesDoc.segments.filter(s => s.seriesSkip);
                if (seriesSkips.length > 0) {
                    const formatted = seriesSkips.map(s => ({ ...s, videoId: cleanId }));
                    segments = [...segments, ...formatted];
                }
            }
        }

    } catch (e) {
        console.error("[SkipService] Retrieval Error:", e.message);
        return [];
    }

    return mergeSegments(segments);
}

// Helper: Merge overlapping or adjacent segments
function mergeSegments(segments) {
    if (!segments || segments.length === 0) return [];

    const processed = segments.map(seg => ({
        ...seg,
        start: Math.round(seg.start),
        end: Math.round(seg.end)
    }));

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
        if (next.start <= (current.end + 1)) {
            current.end = Math.max(current.end, next.end);
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

async function getSegmentCount() {
    await ensureInit();
    try {
        const result = await skipRepository.getGlobalStats();
        return result[0]?.total || 0;
    } catch (e) {
        return 0;
    }
}

async function getAllSegments() {
    await ensureInit();
    const allDocs = await skipRepository.find({});
    const map = {};
    allDocs.forEach(d => map[d.fullId] = d.segments);
    return map;
}

/**
 * Get recent segments for the activity ticker.
 * Returns an array of recent segment submissions sorted by createdAt desc.
 */
async function getRecentSegments(limit = 20) {
    await ensureInit();
    try {
        // Query all documents and flatten their segments with fullId
        const allDocs = await skipRepository.find({}, {
            projection: { fullId: 1, segments: 1 },
            limit: 100 // Limit docs to avoid loading everything
        });

        const allSegments = [];
        allDocs.forEach(doc => {
            if (doc.segments) {
                doc.segments.forEach(seg => {
                    if (seg.createdAt) {
                        allSegments.push({
                            videoId: doc.fullId,
                            label: seg.label || 'Intro',
                            createdAt: seg.createdAt,
                            source: seg.source || 'community'
                        });
                    }
                });
            }
        });

        // Sort by createdAt descending and take top N
        allSegments.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        return allSegments.slice(0, limit);
    } catch (e) {
        console.error('[SkipService] getRecentSegments error:', e.message);
        return [];
    }
}

// --- External API Integrations ---

async function getMalId(imdbId) {
    const cached = await cacheRepository.getCache(`mal:${imdbId}`);
    if (cached) return cached;

    try {
        const metaRes = await axios.get(`https://v3-cinemeta.strem.io/meta/series/${imdbId}.json`);
        const name = metaRes.data?.meta?.name;
        if (!name) return null;

        console.log(`[SkipService] Searching MAL ID for "${name}"...`);
        const jikanRes = await axios.get(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(name)}&type=tv&limit=1`);

        if (jikanRes.data?.data?.[0]?.mal_id) {
            const malId = jikanRes.data.data[0].mal_id;
            console.log(`[SkipService] Mapped ${imdbId} (${name}) -> MAL ${malId}`);
            await cacheRepository.setCache(`mal:${imdbId}`, malId);
            return malId;
        }
    } catch (e) {
        console.error(`[SkipService] Mapping failed for ${imdbId}: ${e.message}`);
    }
    return null;
}

async function fetchAniskip(malId, episode) {
    const cacheKey = `aniskip:${malId}:${episode}`;
    const cached = await cacheRepository.getCache(cacheKey);
    if (cached !== null && cached !== undefined) return cached;

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
                await cacheRepository.setCache(cacheKey, result);
                return result;
            }
        }
    } catch (e) { }

    await cacheRepository.setCache(cacheKey, null);
    return null;
}

// ANIME_SKIP_CLIENT_ID moved to config/constants.js

async function fetchAnimeSkip(malId, episode, imdbId) {
    const cacheKey = `as:${malId || imdbId}:${episode}`;
    const cached = await cacheRepository.getCache(cacheKey);
    if (cached !== null && cached !== undefined) return cached;

    try {
        let showId = null;
        let name = null;
        if (imdbId) {
            try {
                const metaRes = await axios.get(`https://v3-cinemeta.strem.io/meta/series/${imdbId}.json`);
                name = metaRes.data?.meta?.name;
            } catch (e) { }
        }

        if (name) {
            const searchRes = await axios.post(ANIME_SKIP.BASE_URL, {
                query: `query ($search: String!) { searchShows(search: $search) { id name } }`,
                variables: { search: name }
            }, { headers: { 'X-Client-ID': ANIME_SKIP.CLIENT_ID } });

            const shows = searchRes.data?.data?.searchShows;
            if (shows && shows.length > 0) {
                const match = shows.find(s => s.name.toLowerCase() === name.toLowerCase()) || shows[0];
                showId = match.id;
            }
        }

        if (!showId) {
            await cacheRepository.setCache(cacheKey, null);
            return null;
        }

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

        const res = await axios.post(ANIME_SKIP.BASE_URL, {
            query,
            variables: { showId, episodeNumber: parseFloat(episode) }
        }, {
            headers: { 'X-Client-ID': ANIME_SKIP.CLIENT_ID }
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

                await cacheRepository.setCache(cacheKey, result);
                return result;
            }
        }
    } catch (e) {
        console.error(`[SkipService] Anime-Skip fetch failed: ${e.message}`);
    }

    await cacheRepository.setCache(cacheKey, null);
    return null;
}

// --- Main Segment Request Handler ---

async function getSkipSegment(fullId) {
    // 1. Check Database/Catalog Hybrid (Optimized path)
    const segments = await getSegments(fullId);
    if (segments && segments.length > 0) {
        const intro = segments.find(s => s.label === 'Intro' || s.label === 'OP');
        if (intro) {
            return {
                start: intro.start,
                end: intro.end,
                source: intro.source || 'community'
            };
        }
    }

    // 2. Parsed ID Check for Third-Party Fallbacks
    const parts = fullId.split(':');
    if (parts.length >= 3) {
        const imdbId = parts[0];
        const episode = parseInt(parts[2]);

        // Hit external APIs (AniSkip first, then Anime-Skip)
        const malId = await getMalId(imdbId);
        if (malId) {
            // Attempt concurrent check for both sources if possible, but sequential for now to preserve priority
            const aniSkip = await fetchAniskip(malId, episode);
            if (aniSkip) {
                console.log(`[SkipService] Found Aniskip for ${fullId}: ${aniSkip.start}-${aniSkip.end}`);
                addSkipSegment(fullId, aniSkip.start, aniSkip.end, 'Intro', 'aniskip').catch(() => { });
                return aniSkip;
            }

            const animeSkip = await fetchAnimeSkip(malId, episode, imdbId);
            if (animeSkip) {
                console.log(`[SkipService] Found Anime-Skip for ${fullId}: ${animeSkip.start}-${animeSkip.end}`);
                addSkipSegment(fullId, animeSkip.start, animeSkip.end, 'Intro', 'anime-skip').catch(() => { });
                return animeSkip;
            }
        }
    }

    return null;
}

// --- Write Operations ---

async function addSkipSegment(fullId, start, end, label = "Intro", userId = "anonymous", applyToSeries = false) {
    await ensureInit();
    const TRUSTED_SOURCES = ['aniskip', 'anime-skip', 'auto-import', 'chapter-bot'];
    const isTrusted = TRUSTED_SOURCES.includes(userId);

    if (typeof start !== 'number' || typeof end !== 'number' || start < 0 || end <= start) {
        throw new Error("Invalid start or end times");
    }

    const cleanLabel = String(label).substring(0, 50);
    let cleanFullId = String(fullId).substring(0, 255);
    let seriesId = null;

    const parts = cleanFullId.split(':');
    if (parts.length >= 3) {
        seriesId = parts[0];
    }

    if (applyToSeries && seriesId) {
        cleanFullId = seriesId;
    }

    // Duplicate check
    const existingSegments = await getSegments(cleanFullId);
    if (existingSegments && existingSegments.length > 0) {
        const isDuplicate = existingSegments.some(s => {
            return Math.abs(s.start - start) < 1.0 && Math.abs(s.end - end) < 1.0;
        });
        if (isDuplicate) return null;
    }

    const newSegment = {
        start, end, label: cleanLabel,
        votes: 1,
        verified: isTrusted,
        source: userId,
        reportCount: 0,
        seriesSkip: applyToSeries === true,
        contributors: [userId],
        createdAt: new Date().toISOString()
    };

    await skipRepository.addSegment(cleanFullId, newSegment, seriesId);

    // Update catalog in background
    const finalSegments = await getSegments(cleanFullId);
    catalogService.registerShow(cleanFullId, finalSegments.length, finalSegments).catch(() => { });

    return newSegment;
}

// --- Moderation Operations ---

async function getPendingModeration() {
    await ensureInit();
    const pending = [];
    const reported = [];

    try {
        const docs = await skipRepository.getPendingModeration();
        docs.forEach(doc => {
            if (doc.segments) {
                doc.segments.forEach((seg, index) => {
                    if (!seg.verified) pending.push({ fullId: doc.fullId, index, ...seg });
                    if (seg.reportCount > 0) reported.push({ fullId: doc.fullId, index, ...seg });
                });
            }
        });
    } catch (e) {
        console.error("[SkipService] Error fetching pending moderation:", e);
    }

    return { pending, reported };
}

async function resolveModerationBulk(items, action) {
    if (!items || !Array.isArray(items) || items.length === 0) return 0;
    await ensureInit();

    const grouped = {};
    for (const item of items) {
        if (!grouped[item.fullId]) grouped[item.fullId] = [];
        grouped[item.fullId].push(item.index);
    }

    let modifiedCount = 0;
    for (const fullId in grouped) {
        const indices = grouped[fullId].sort((a, b) => b - a); // Process from back to front for splicing
        const doc = await skipRepository.findByFullId(fullId);
        if (!doc || !doc.segments) continue;

        let changed = false;
        indices.forEach(idx => {
            if (action === 'delete') {
                doc.segments.splice(idx, 1);
                changed = true;
            } else if (action === 'approve') {
                if (doc.segments[idx]) {
                    doc.segments[idx].verified = true;
                    doc.segments[idx].reportCount = 0;
                    changed = true;
                }
            }
        });

        if (changed) {
            await skipRepository.updateSegments(fullId, doc.segments);
            modifiedCount += indices.length;
        }
    }
    return modifiedCount;
}

async function resolveModeration(fullId, index, action) {
    return await resolveModerationBulk([{ fullId, index }], action) > 0;
}

async function reportSegment(fullId, index) {
    await ensureInit();
    const doc = await skipRepository.findByFullId(fullId);
    if (!doc || !doc.segments[index]) return false;
    doc.segments[index].reportCount = (doc.segments[index].reportCount || 0) + 1;
    await skipRepository.updateSegments(fullId, doc.segments);
    return true;
}

async function forceSave() {
    // No-op
}

async function cleanupDuplicates() {
    await ensureInit();
    console.log('[SkipService] Starting duplicate cleanup...');
    // ... logic remains standard but strictly DB
    return 0; // Simplified for now
}

module.exports = {
    getSkipSegment,
    getSegments,
    getAllSegments,
    getRecentSegments,
    getSegmentCount,
    addSkipSegment,
    cleanupDuplicates,
    getPendingModeration,
    resolveModeration,
    resolveModerationBulk,
    reportSegment,
    forceSave
};

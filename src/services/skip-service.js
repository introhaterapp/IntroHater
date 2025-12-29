const skipRepository = require('../repositories/skip.repository');
const cacheRepository = require('../repositories/cache.repository');
const axios = require('axios');
const catalogService = require('./catalog');
const { ANIME_SKIP, INTRO_DB } = require('../config/constants');
const log = require('../utils/logger').skip;


let initPromise = null;

async function ensureInit() {
    if (initPromise) return initPromise;

    initPromise = (async () => {
        try {
            log.info('Initializing Database-Only Storage...');
            await skipRepository.ensureInit();
            await cacheRepository.ensureInit();
        } catch (e) {
            log.error({ err: e }, 'Init Error');
        }
    })();

    return initPromise;
}


ensureInit();




async function getSegments(fullId) {
    await ensureInit();

    const cleanId = String(fullId).trim();
    let segments = [];

    
    const parts = cleanId.split(':');
    let imdbId, epKey, isSeriesRequest;

    if (cleanId.startsWith('kitsu:')) {
        imdbId = parts.slice(0, 2).join(':'); 
        isSeriesRequest = parts.length < 3;
        epKey = !isSeriesRequest ? parts[2] : null; 
    } else {
        imdbId = parts[0]; 
        isSeriesRequest = parts.length < 3;
        epKey = !isSeriesRequest ? `${parts[1]}:${parts[2]}` : null; 
    }

    try {
        
        const media = await catalogService.getShowByImdbId(imdbId);

        if (media && media.episodes) {
            if (isSeriesRequest) {
                
                for (const key in media.episodes) {
                    if (media.episodes[key].segments) {
                        const epSegments = media.episodes[key].segments.map(s => ({ ...s, videoId: `${imdbId}:${key}` }));
                        segments.push(...epSegments);
                    }
                }
            } else if (media.episodes[epKey] && media.episodes[epKey].segments) {
                
                segments = media.episodes[epKey].segments.map(s => ({ ...s, videoId: cleanId }));
            }

            if (segments.length > 0) {
                
                return mergeSegments(segments);
            }
        }

        
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

            
            if (Object.keys(segmentsByEp).length > 0) {
                catalogService.bakeShowSegments(imdbId, segmentsByEp).catch(() => { });
            }
        } else {
            
            const doc = await skipRepository.findByFullId(cleanId);
            if (doc && doc.segments) {
                segments = doc.segments.map(s => ({ ...s, videoId: cleanId }));
            }
        }

        
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
        log.error({ err: e.message }, 'Retrieval Error');
        return [];
    }

    return mergeSegments(segments);
}


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
    } catch {
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


async function getRecentSegments(limit = 20) {
    await ensureInit();
    try {
        return await skipRepository.getRecentSegments(limit);
    } catch (e) {
        log.error({ err: e.message }, 'getRecentSegments error');
        return [];
    }
}



async function getMalId(imdbId) {
    const cleanId = String(imdbId).trim();

    
    if (cleanId.startsWith('kitsu:')) {
        return await getMalIdFromKitsu(cleanId);
    }

    const cached = await cacheRepository.getCache(`mal:${cleanId}`);
    if (cached) return cached;

    try {
        const metaRes = await axios.get(`https://v3-cinemeta.strem.io/meta/series/${imdbId}.json`);
        const name = metaRes.data?.meta?.name;
        if (!name) return null;

        log.info({ name }, 'Searching MAL ID');
        const jikanRes = await axios.get(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(name)}&type=tv&limit=1`);

        if (jikanRes.data?.data?.[0]?.mal_id) {
            const malId = jikanRes.data.data[0].mal_id;
            log.info({ imdbId, name, malId }, 'Mapped to MAL ID');
            await cacheRepository.setCache(`mal:${imdbId}`, malId);
            return malId;
        }
    } catch (e) {
        log.error({ imdbId, err: e.message }, 'MAL ID mapping failed');
    }
    return null;
}

async function getMalIdFromKitsu(kitsuId) {
    const cached = await cacheRepository.getCache(`mal:${kitsuId}`);
    if (cached) return cached;

    const idOnly = kitsuId.split(':')[1];
    if (!idOnly) return null;

    try {
        log.info({ kitsuId }, 'Fetching MAL mapping from Kitsu API');
        const url = `https://kitsu.io/api/edge/anime/${idOnly}/mappings?filter[external_site]=myanimelist/anime`;
        const res = await axios.get(url, { headers: { 'Accept': 'application/vnd.api+json' } });

        const malMapping = res.data?.data?.[0];
        if (malMapping?.attributes?.externalId) {
            const malId = malMapping.attributes.externalId;
            log.info({ kitsuId, malId }, 'Found MAL ID via Kitsu mapping');
            await cacheRepository.setCache(`mal:${kitsuId}`, malId);
            return malId;
        }

        
        const metaRes = await axios.get(`https://v3-cinemeta.strem.io/meta/anime/${kitsuId}.json`);
        const name = metaRes.data?.meta?.name;
        if (name) {
            log.info({ name }, 'Searching MAL ID by anime name');
            const jikanRes = await axios.get(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(name)}&type=tv&limit=1`);
            if (jikanRes.data?.data?.[0]?.mal_id) {
                const malId = jikanRes.data.data[0].mal_id;
                await cacheRepository.setCache(`mal:${kitsuId}`, malId);
                return malId;
            }
        }
    } catch (e) {
        log.error({ kitsuId, err: e.message }, 'Kitsu mapping failed');
    }

    await cacheRepository.setCache(`mal:${kitsuId}`, null);
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
    } catch {  }

    await cacheRepository.setCache(cacheKey, null);
    return null;
}



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
            } catch {  }
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
        log.error({ err: e.message }, 'Anime-Skip fetch failed');
    }

    await cacheRepository.setCache(cacheKey, null);
    return null;
}

async function fetchIntroDB(imdbId, season, episode) {
    const cacheKey = `introdb:${imdbId}:${season}:${episode}`;
    const cached = await cacheRepository.getCache(cacheKey);
    if (cached !== null && cached !== undefined) return cached;

    try {
        const url = `${INTRO_DB.BASE_URL}/intro?imdb_id=${imdbId}&season=${season}&episode=${episode}`;
        log.info({ url }, 'Fetching from IntroDB');
        const res = await axios.get(url);

        
        if (res.data && res.data.start_sec != null && res.data.end_sec != null) {
            const segments = [{
                start: res.data.start_sec,
                end: res.data.end_sec,
                label: 'Intro',
                source: 'introdb'
            }];

            log.info({ imdbId, season, episode, start: segments[0].start, end: segments[0].end }, 'IntroDB hit');
            await cacheRepository.setCache(cacheKey, segments);
            return segments;
        }
    } catch (e) {
        
        if (e.response?.status !== 404) {
            log.error({ imdbId, season, episode, err: e.message }, 'IntroDB fetch failed');
        }
    }

    await cacheRepository.setCache(cacheKey, null);
    return null;
}



async function getSkipSegment(fullId) {
    
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

    
    const parts = fullId.split(':');
    if (parts.length >= 3) {
        let imdbId, season, episode;

        if (fullId.startsWith('kitsu:')) {
            imdbId = parts.slice(0, 2).join(':'); 
            season = 1;
            episode = parseInt(parts[2]);
        } else {
            imdbId = parts[0];
            season = parseInt(parts[1]);
            episode = parseInt(parts[2]);
        }

        
        if (imdbId.startsWith('tt')) {
            const introDbSegments = await fetchIntroDB(imdbId, season, episode);
            if (introDbSegments) {
                const intro = introDbSegments.find(s => s.label === 'Intro');
                if (intro) {
                    log.info({ fullId, start: intro.start, end: intro.end }, 'Found IntroDB');
                    
                    for (const s of introDbSegments) {
                        addSkipSegment(fullId, s.start, s.end, s.label, 'introdb').catch(() => { });
                    }
                    return intro;
                }
            }
        }

        
        const malId = await getMalId(imdbId);
        if (malId) {
            const aniSkip = await fetchAniskip(malId, episode);
            if (aniSkip) {
                log.info({ fullId, start: aniSkip.start, end: aniSkip.end }, 'Found Aniskip');
                addSkipSegment(fullId, aniSkip.start, aniSkip.end, 'Intro', 'aniskip').catch(() => { });
                return aniSkip;
            }

            const animeSkip = await fetchAnimeSkip(malId, episode, imdbId);
            if (animeSkip) {
                log.info({ fullId, start: animeSkip.start, end: animeSkip.end }, 'Found Anime-Skip');
                addSkipSegment(fullId, animeSkip.start, animeSkip.end, 'Intro', 'anime-skip').catch(() => { });
                return animeSkip;
            }
        }
    }

    return null;
}



async function addSkipSegment(fullId, start, end, label = "Intro", userId = "anonymous", applyToSeries = false) {
    await ensureInit();
    const TRUSTED_SOURCES = ['aniskip', 'anime-skip', 'auto-import', 'chapter-bot', 'introdb']; 
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

    
    const existingDoc = await skipRepository.findOne({ fullId: cleanFullId });
    if (existingDoc && existingDoc.segments && existingDoc.segments.length > 0) {
        const isDuplicate = existingDoc.segments.some(s => {
            return Math.abs(s.start - start) < 1.0 && Math.abs(s.end - end) < 1.0;
        });
        if (isDuplicate) {
            return null; 
        }
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

    
    const finalSegments = await getSegments(cleanFullId);
    catalogService.registerShow(cleanFullId, finalSegments.length, finalSegments).catch(() => { });

    return newSegment;
}



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
        log.error({ err: e }, 'Error fetching pending moderation');
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
        const indices = grouped[fullId].sort((a, b) => b - a); 
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



async function cleanupDuplicates() {
    await ensureInit();
    log.info('Starting duplicate cleanup...');

    let totalRemoved = 0;
    try {
        const docs = await skipRepository.find({ "segments.1": { $exists: true } }); 

        for (const doc of docs) {
            const originalCount = doc.segments.length;
            const uniqueSegments = [];

            for (const seg of doc.segments) {
                const isDuplicate = uniqueSegments.some(existing =>
                    Math.abs(existing.start - seg.start) < 1.0 &&
                    Math.abs(existing.end - seg.end) < 1.0
                );

                if (!isDuplicate) {
                    uniqueSegments.push(seg);
                }
            }

            if (uniqueSegments.length < originalCount) {
                const removedCount = originalCount - uniqueSegments.length;
                log.info(`Removing ${removedCount} duplicates from ${doc.fullId}`);
                await skipRepository.updateSegments(doc.fullId, uniqueSegments);
                totalRemoved += removedCount;
            }
        }
    } catch (e) {
        log.error(`Duplicate cleanup failed: ${e.message}`);
    }

    return totalRemoved;
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
    reportSegment
};

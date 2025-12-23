require('dotenv').config();
const { addonBuilder, getRouter } = require("stremio-addon-sdk");
const express = require('express');
const cors = require('cors');
const path = require('path');
const { getByteOffset, generateSmartManifest, getStreamDetails, getRefinedOffsets, generateSpliceManifest, getChapters } = require('./src/services/hls-proxy');
const skipService = require('./src/services/skip-service');
const { getSkipSegment, getSegments, getAllSegments } = skipService;
const catalogService = require('./src/services/catalog');
const userService = require('./src/services/user-service');
const indexerService = require('./src/services/indexer');
const axios = require('axios');

// Configure ffmpeg/ffprobe paths
const ffmpeg = require('fluent-ffmpeg');
const crypto = require('crypto');
const helmet = require('helmet');
const hpp = require('hpp');
const rateLimit = require('express-rate-limit');
const { generateUserToken, verifyUserToken } = require('./src/utils/auth.js');
const { SECURITY } = require('./src/config/constants');
const fs = require('fs').promises;

// In production, we use the system-installed ffmpeg (from apt-get)
// We only use static binaries for local Windows dev if needed
if (process.platform === 'win32') {
    try {
        const ffmpegPath = require('ffmpeg-static');
        const ffprobePath = require('ffprobe-static').path;
        ffmpeg.setFfmpegPath(ffmpegPath);
        ffmpeg.setFfprobePath(ffprobePath);
    } catch (e) { console.log("Using system ffmpeg"); }
} else {
    // Linux/Docker: Use system paths
    ffmpeg.setFfmpegPath('ffmpeg');
    ffmpeg.setFfprobePath('ffprobe');
}

// Helper: Format Seconds to VTT Time (HH:MM:SS.mmm)
function toVTTTime(seconds) {
    const date = new Date(0);
    date.setMilliseconds(seconds * 1000);
    return date.toISOString().substr(11, 12);
}

// Helper: Generate Secure User ID from RD Key
function generateUserId(rdKey) {
    if (!rdKey) return 'anonymous';
    return crypto.createHash('sha256').update(rdKey).digest('hex').substring(0, 32);
}

// Helper: Persistent Metadata Cache
const METADATA_CACHE_FILE = path.join(__dirname, 'data', 'metadata_cache.json');
global.metadataCache = {};

async function loadMetadataCache() {
    try {
        const data = await fs.readFile(METADATA_CACHE_FILE, 'utf8');
        global.metadataCache = JSON.parse(data);
        console.log(`[Cache] Loaded ${Object.keys(global.metadataCache).length} items from persistent cache.`);
    } catch (e) {
        console.log("[Cache] Starting with empty metadata cache.");
    }
}

// Startup Repair
setTimeout(async () => {
    try {
        const allSkips = await skipService.getAllSegments();
        await catalogService.repairCatalog(allSkips);
    } catch (e) {
        console.error("Repair failed:", e);
    }
}, 5000);

async function saveMetadataCache() {
    try {
        const dir = path.dirname(METADATA_CACHE_FILE);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(METADATA_CACHE_FILE, JSON.stringify(global.metadataCache, null, 2));
    } catch (e) {
        console.error("[Cache] Failed to save metadata cache:", e.message);
    }
}

// Helper: Fetch OMDb Data with Caching
async function fetchOMDbData(imdbId, apiKey) {
    if (global.metadataCache[imdbId]) return global.metadataCache[imdbId];

    try {
        const url = `https://www.omdbapi.com/?i=${imdbId}&apikey=${apiKey}`;
        const res = await axios.get(url);
        if (res.data && res.data.Response === 'True') {
            global.metadataCache[imdbId] = res.data;
            console.log(`[OMDB] Fetched metadata for ${imdbId}: ${res.data.Title}`);
            saveMetadataCache(); // Persistent save
            return res.data;
        }
    } catch (e) {
        return null;
    }
    return null;
}

// Configuration
const PORT = process.env.PORT || 7005;
const PUBLIC_URL = process.env.PUBLIC_URL || `http://127.0.0.1:${PORT}`;

// Manifest
const manifest = {
    id: "org.introhater",
    version: "1.0.0",
    name: "IntroHater",
    description: "Universal Skip Intro for Stremio (TV/Mobile/PC)",
    resources: ["stream"],
    types: ["movie", "series", "anime"],
    catalogs: [],
    behaviorHints: {
        configurable: true,
        configurationRequired: false
    }
};

const builder = new addonBuilder(manifest);

// Stream Handler Function
async function handleStreamRequest(type, id, rdKey, baseUrl) {
    if (!rdKey) {
        console.error("[Server] No RD Key provided.");
        return { streams: [] };
    }

    console.log(`[Server] Request for ${type} ${id}`);
    let originalStreams = [];

    try {
        const torrentioUrl = `https://torrentio.strem.fun/providers=yts,eztv,rarbg,1337x,thepiratebay,kickasstorrents,torrentgalaxy,magnetdl,horriblesubs,nyaasi,tokyotosho,anidex,rutor,rutracker,torrent9,mejortorrent,wolfmax4k%7Csort=qualitysize%7Clanguage=korean%7Cqualityfilter=scr,cam%7Cdebridoptions=nodownloadlinks,nocatalog%7Crealdebrid=${rdKey}/stream/${type}/${id}.json`;

        const response = await axios.get(torrentioUrl);
        if (response.status === 200) {
            const data = response.data;
            if (data.streams) {
                originalStreams = data.streams;
                console.log(`[Server] Fetched ${originalStreams.length} streams from upstream`);
            }
        }
    } catch (e) {
        console.error("Error fetching upstream:", e.message);
    }

    if (originalStreams.length === 0) return { streams: [] };

    // FETCH SKIP (Async now because of Aniskip)
    const skipSeg = await getSkipSegment(id);
    if (skipSeg) {
        console.log(`[Server] Found skip for ${id}: ${skipSeg.start}-${skipSeg.end}s`);
    }

    const modifiedStreams = [];

    originalStreams.forEach((stream) => {
        if (!stream.url) return;

        const encodedUrl = encodeURIComponent(stream.url);
        const userId = generateUserId(rdKey);

        // Pass 0,0 if no skip found - the manifest handler will handle it.
        const start = skipSeg ? skipSeg.start : 0;
        const end = skipSeg ? skipSeg.end : 0;

        const proxyUrl = `${baseUrl}/hls/manifest.m3u8?stream=${encodedUrl}&start=${start}&end=${end}&id=${id}&user=${userId}&rdKey=${rdKey}`;

        // Determine indicator
        const indicator = skipSeg ? "🚀" : "🔍";

        modifiedStreams.push({
            ...stream,
            url: proxyUrl,
            title: `${indicator} [IntroHater] ${stream.title || stream.name}`,
            behaviorHints: { notWebReady: false }
        });
    });

    return { streams: modifiedStreams };
}

// Express Server
const app = express();
app.set('trust proxy', 1);
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://code.jquery.com", "https://cdn.datatables.net", "https://static.cloudflareinsights.com"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.datatables.net", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            imgSrc: ["'self'", "data:", "https://cdn.datatables.net"],
            connectSrc: ["'self'"], // Add external APIs here if client-side fetches are needed later
        },
    },
}));
app.use(hpp());
app.use(cors());
app.use(express.json());

// Global Rate Limiter
const globalLimiter = rateLimit({
    windowMs: SECURITY.RATE_LIMITS.GLOBAL.WINDOW_MS,
    max: SECURITY.RATE_LIMITS.GLOBAL.MAX_REQUESTS,
    message: { error: "Too many requests, please try again later." }
});
app.use('/api/', globalLimiter);

// 1. Serve Website (Docs)
app.use(express.static(path.join(__dirname, 'docs')));

// Handle /configure and /:config/configure to redirect to main page or serve it
app.get(['/configure', '/:config/configure'], (req, res) => {
    // If config is present, we could potentially inject it, but for now just serving the static HTML is safer/easier.
    // The user can re-enter their key or we can parse it from URL in frontend if we want to be fancy.
    // For now, let's just serve the file.
    res.sendFile(path.join(__dirname, 'docs', 'configure.html'));
});

// Middleware to extract config (RD Key)
// Supports /:config/manifest.json and /manifest.json (fallback env)
app.get(['/:config/manifest.json', '/manifest.json'], (req, res) => {
    const config = req.params.config;
    const manifestClone = { ...manifest };

    if (config) {
        manifestClone.description += " (Configured)";
    }

    res.json(manifestClone);
});

app.get(['/:config/stream/:type/:id.json', '/stream/:type/:id.json'], async (req, res) => {
    const { config, type, id } = req.params;
    // Prefer config from URL, fallback to env var
    const rdKey = config || process.env.RPDB_KEY;

    if (!rdKey) {
        return res.json({ streams: [{ title: "⚠️ Configuration Required. Please reinstall addon.", url: "" }] });
    }

    // Handle .json extension in ID if present (Stremio quirks)
    const cleanId = id.replace('.json', '');
    const protocol = req.protocol;
    const host = req.get('host');
    const baseUrl = `${protocol}://${host}`;

    // Pass baseUrl to handleStreamRequest
    const result = await handleStreamRequest(type, cleanId, rdKey, baseUrl);
    res.json(result);
});

// 2. API: Leaderboard
app.get('/api/leaderboard', async (req, res) => {
    // Increased limit to 100 to allow client-side sorting visibility
    const board = await userService.getLeaderboard(100);

    // Return Object format expected by leaderboard.html
    res.json({
        users: board.map((u, i) => ({
            rank: i + 1,
            userId: u.userId,
            segments: u.segments,
            votes: u.votes,
            savedTime: u.savedTime || 0
        })),
        lastUpdated: new Date().toISOString()
    });
});

// 2.5 API: Stats
let statsCache = { timestamp: 0, data: null };

app.get('/api/stats', async (req, res) => {
    // Check Cache (Top of the hour invalidation)
    const now = new Date();
    if (statsCache.data && statsCache.timestamp > 0) {
        const last = new Date(statsCache.timestamp);
        // Valid if: Same Year, Same Month, Same Day, Same Hour
        if (now.getFullYear() === last.getFullYear() &&
            now.getMonth() === last.getMonth() &&
            now.getDate() === last.getDate() &&
            now.getHours() === last.getHours()) {
            return res.json(statsCache.data);
        }
    }

    const { userCount, voteCount, totalSavedTime } = await userService.getStats();
    // Get total skips from all segments
    const allSkips = await getAllSegments();
    const localSegmentCount = Object.values(allSkips).flat().length;

    // Ani-Skip Estimate (Educated guess based on community data)
    const ANISKIP_ESTIMATE = 145000;

    // Anime-Skip Live Stats
    let animeSkipCount = 0;
    let animeSkipShows = 0;
    let animeSkipEpisodes = 0;
    try {
        const query = `query { counts { timestamps shows episodes } }`;
        const asRes = await axios.post('https://api.anime-skip.com/graphql',
            { query },
            { headers: { 'X-Client-ID': 'th2oogUKrgOf1J8wMSIUPV0IpBMsLOJi' }, timeout: 2000 }
        );
        animeSkipCount = asRes.data?.data?.counts?.timestamps || 0;
        animeSkipShows = asRes.data?.data?.counts?.shows || 0;
        animeSkipEpisodes = asRes.data?.data?.counts?.episodes || 0;
    } catch (e) {
        console.warn("[Stats] Failed to fetch live Anime-Skip stats:", e.message);
    }

    // Get catalog data for shows/episodes counts
    let localShowCount = 0;
    let localEpisodeCount = 0;
    try {
        const stats = await catalogService.getCatalogStats();
        localShowCount = stats.showCount;
        localEpisodeCount = stats.episodeCount;
    } catch (e) {
        console.warn("[Stats] Failed to calculate catalog counts:", e.message);
    }

    const responseData = {
        users: userCount,
        skips: localSegmentCount + ANISKIP_ESTIMATE + animeSkipCount, // Total skips served (Combined)
        savedTime: totalSavedTime || 0, // Global Saved Time in seconds
        votes: voteCount,
        segments: localSegmentCount, // Local community segments
        showCount: localShowCount + animeSkipShows,
        episodeCount: localEpisodeCount + animeSkipEpisodes,
        sources: {
            local: localSegmentCount,
            aniskip: ANISKIP_ESTIMATE,
            animeSkip: animeSkipCount
        }
    };

    // Update Cache
    statsCache = {
        timestamp: now.getTime(),
        data: responseData
    };

    res.json(responseData);
});

// 2.6 API: Personal Stats (Protected by RD Key)
app.use(express.json()); // Enable JSON body parsing
app.post('/api/stats/personal', async (req, res) => {
    const { rdKey } = req.body;
    if (!rdKey) return res.status(400).json({ error: "RD Key required" });

    try {
        // --- VERIFY RD KEY ---
        try {
            await axios.get('https://api.real-debrid.com/rest/1.0/user', {
                headers: { 'Authorization': `Bearer ${rdKey}` },
                timeout: 3000
            });
        } catch (e) {
            return res.status(401).json({ error: "Invalid Real-Debrid Key" });
        }

        const userId = generateUserId(rdKey);
        const stats = await userService.getUserStats(userId);

        if (stats) {
            // Calculate rank
            const leaderboard = await userService.getLeaderboard(1000);
            const rank = leaderboard.findIndex(u => u.userId === userId) + 1;

            // Resolve history metadata (Titles instead of pure IDs)
            const omdbKey = process.env.OMDB_API_KEY;
            const enrichedHistory = await Promise.all((stats.watchHistory || []).slice(0, 15).map(async (item) => {
                const parts = item.videoId.split(':');
                const imdbId = parts[0];
                const season = parts[1];
                const episode = parts[2];

                let title = imdbId;
                if (!global.metadataCache) global.metadataCache = {};

                // Use cached title if available, otherwise just use ID for speed
                if (global.metadataCache[imdbId]) {
                    title = global.metadataCache[imdbId].Title;
                } else if (omdbKey) {
                    // Quick fetch (fire and forget for next time if we want, but let's try await for now)
                    try {
                        const data = await fetchOMDbData(imdbId, omdbKey);
                        if (data && data.Title) {
                            global.metadataCache[imdbId] = data;
                            title = data.Title;
                        }
                    } catch (e) { }
                }

                return {
                    ...item,
                    title: season && episode ? `${title} S${season}E${episode}` : title
                };
            }));

            res.json({
                ...stats,
                userId: userId,
                savedTime: stats.savedTime || 0,
                rank: rank > 0 ? rank : "-",
                history: enrichedHistory
            });
        } else {
            res.json({ userId: userId, segments: 0, votes: 0, savedTime: 0, rank: "-", history: [] });
        }
    } catch (e) {
        console.error("Personal Stats error:", e);
        res.status(500).json({ error: "Internal server error" });
    }
});

// 2.7 API: Report Issue (From Dashboard)
app.post('/api/report', async (req, res) => {
    const { rdKey, videoId, reason, segmentIndex } = req.body;
    if (!rdKey || !videoId) return res.status(400).json({ error: "RD Key and Video ID required" });

    const userId = generateUserId(rdKey);
    console.log(`[Report] User ${userId.substr(0, 6)} reported ${videoId} (Seg: ${segmentIndex}): ${reason || 'No reason'}`);

    // Verify RD Key to prevent spam
    try {
        await axios.get('https://api.real-debrid.com/rest/1.0/user', {
            headers: { 'Authorization': `Bearer ${rdKey}` }
        });
    } catch (e) {
        return res.status(401).json({ error: "Invalid Real-Debrid Key. Only real users can report." });
    }

    // Register Report in Skip Service
    await skipService.reportSegment(videoId, segmentIndex || 0);

    // Track impact
    await userService.updateUserStats(userId, {
        votes: -1,
        videoId: videoId
    });

    res.json({ success: true, message: "Issue reported. Thank you!" });
});

// 2.8 API: Search (Proxy to OMDB)
app.get('/api/search', async (req, res) => {
    const { q } = req.query;
    const omdbKey = process.env.OMDB_API_KEY;
    if (!q || !omdbKey) return res.json({ Search: [] });

    try {
        const response = await axios.get(`https://www.omdbapi.com/?s=${encodeURIComponent(q)}&apikey=${omdbKey}`);
        res.json(response.data);
    } catch (e) {
        res.status(500).json({ error: "Search failed" });
    }
});

// 2.9 API: Submit Segment
app.post('/api/submit', async (req, res) => {
    const { rdKey, imdbID, season, episode, start, end, label, applyToSeries } = req.body;
    if (!rdKey || !imdbID || start === undefined || end === undefined) {
        return res.status(400).json({ error: "Missing required fields" });
    }

    // Verify RD Key to prevent bot submissions
    try {
        const rdCheck = await axios.get('https://api.real-debrid.com/rest/1.0/user', {
            headers: { 'Authorization': `Bearer ${rdKey}` }
        });
        if (!rdCheck.data || !rdCheck.data.id) throw new Error("Invalid user");
    } catch (e) {
        return res.status(401).json({ error: "Invalid Real-Debrid Key. Only active RD users can contribute." });
    }

    const userId = generateUserId(rdKey);

    // Improved ID Construction: Prevent doubling if imdbID already contains colons (full ID)
    let fullId = imdbID;
    if (season && episode && !imdbID.includes(':')) {
        fullId = `${imdbID}:${season}:${episode}`;
    }

    // Log proper context
    if (applyToSeries) {
        console.log(`[Submit] User ${userId.substr(0, 6)} submitted GLOBAL SERIES SKIP ${start}-${end}s for ${imdbID}`);
    } else {
        console.log(`[Submit] User ${userId.substr(0, 6)} submitted ${start}-${end}s for ${fullId}`);
    }

    const newSeg = await skipService.addSkipSegment(fullId, parseFloat(start), parseFloat(end), label || "Intro", userId, applyToSeries);

    // Give user credit
    await userService.updateUserStats(userId, {
        segments: 1
    });

    res.json({ success: true, segment: newSeg });
});

// 2.10 API: Admin Moderation (Protected)
const ADMIN_PASS = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASS) {
    console.warn("CRITICAL: ADMIN_PASSWORD not set. Admin API is DISABLED.");
}

// 2.11 API: Generate Extension Token
app.post('/api/generate-token', async (req, res) => {
    const { userId, rdKey } = req.body;
    const apiKey = req.headers['x-api-key'];

    // Extension usually sends X-API-Key or we can verify via RD Key
    if (apiKey !== process.env.API_KEY && !rdKey) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    // If RD Key provided, verify it first
    if (rdKey) {
        try {
            await axios.get('https://api.real-debrid.com/rest/1.0/user', {
                headers: { 'Authorization': `Bearer ${rdKey}` },
                timeout: 5000
            });
        } catch (e) {
            return res.status(401).json({ error: "Invalid RD Key" });
        }
    }

    const tokenData = generateUserToken(userId);
    await userService.storeUserToken(userId, tokenData.token, tokenData.timestamp, tokenData.nonce);
    await userService.storeUserToken(userId, tokenData.token, tokenData.timestamp, tokenData.nonce);
    res.json(tokenData);
});

// 2.12 API: Track Skip (From Extension)
app.post('/api/track/skip', async (req, res) => {
    const { userId, token, duration } = req.body;

    // 1. Verify Token
    if (!userId || !token || !duration) {
        return res.status(400).json({ error: "Missing required fields" });
    }

    const isValid = await verifyUserToken(userId, token);
    if (!isValid) {
        return res.status(401).json({ error: "Invalid or expired token" });
    }

    // 2. Increment Stats
    await userService.incrementSavedTime(userId, parseFloat(duration));

    res.json({ success: true });
});

app.post('/api/admin/pending', async (req, res) => {
    const { password } = req.body;
    if (password !== ADMIN_PASS) return res.status(401).json({ error: "Unauthorized" });

    const data = await skipService.getPendingModeration();

    // Helper to enrich items with titles
    const enrich = async (list) => {
        return Promise.all(list.map(async (item) => {
            const parts = item.fullId.split(':');
            const imdbId = parts[0];
            const season = parts[1];
            const episode = parts[2];

            let title = imdbId;
            // Check Server Cache
            if (global.metadataCache && global.metadataCache[imdbId]) {
                title = global.metadataCache[imdbId].Title;
            } else {
                // Try OMDb if key exists (optional, might be slow for many items, maybe skip for now to avoid timeout again?)
                // Let's rely on what's in cache or just return ID if not found to be safe.
                // Or check Catalog Service?
                // For now, let's keep it fast. If it's in cache, great.
            }

            const displayTitle = season && episode ? `${title} S${season}E${episode}` : title;
            return { ...item, displayTitle, imdbId };
        }));
    };

    const pending = await enrich(data.pending);
    const reported = await enrich(data.reported);

    res.json({ pending, reported });
});

app.post('/api/admin/resolve', async (req, res) => {
    const { password, fullId, index, action } = req.body;
    if (password !== ADMIN_PASS) return res.status(401).json({ error: "Unauthorized" });

    const success = await skipService.resolveModeration(fullId, index, action);
    res.json({ success });
});

app.post('/api/admin/resolve-bulk', async (req, res) => {
    const { password, items, action } = req.body;
    if (password !== ADMIN_PASS) return res.status(401).json({ error: "Unauthorized" });
    if (!items || !Array.isArray(items)) return res.status(400).json({ error: "Invalid items" });

    const count = await skipService.resolveModerationBulk(items, action);
    res.json({ success: true, count });
});

// 3. API: Catalog (Built from Skips)
// 3. API: Catalog (Built from Skips with OMDB Metadata)
// 3. API: Catalog (Universal Registry)
app.get('/api/catalog', async (req, res) => {
    try {
        const catalog = await catalogService.getCatalogData();
        res.json(catalog);
    } catch (e) {
        res.status(500).json({ error: "Failed to load catalog" });
    }
});



// 4. API: Get Segments
// 4. API: Get Segments
app.get('/api/segments/:videoId', async (req, res) => {
    const list = await skipService.getSegments(req.params.videoId);
    res.json(list);
});

// 5. Auth Mock
app.get('/me', (req, res) => res.json(null));

app.get('/ping', (req, res) => res.send('pong'));

// Basic LRU Cache Implementation for Manifests
class SimpleLRUCache {
    constructor(maxSize = 500) {
        this.maxSize = maxSize;
        this.cache = new Map();
    }
    get(key) {
        if (!this.cache.has(key)) return null;
        const value = this.cache.get(key);
        this.cache.delete(key);
        this.cache.set(key, value);
        return value;
    }
    set(key, value) {
        if (this.cache.has(key)) this.cache.delete(key);
        else if (this.cache.size >= this.maxSize) {
            this.cache.delete(this.cache.keys().next().value);
        }
        this.cache.set(key, value);
    }
    has(key) { return this.cache.has(key); }
}

const manifestCache = new SimpleLRUCache(1000);

// SSRF Protection: Block internal/private IP ranges
function isSafeUrl(urlStr) {
    try {
        const url = new URL(urlStr);
        const host = url.hostname.toLowerCase();

        // Block localhost and common private ranges
        if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '::1') return false;

        // Private IP Ranges (simplified check)
        if (host.startsWith('10.') ||
            host.startsWith('192.168.') ||
            host.match(/^172\.(1[6-9]|2[0-9]|3[0-1])\./)) return false;

        // Metadata services
        if (host === '169.254.169.254') return false;

        return ['http:', 'https:'].includes(url.protocol);
    } catch (e) {
        return false;
    }
}

app.get('/sub/status/:videoId.vtt', (req, res) => {
    const vid = req.params.videoId;
    const segments = getSegments(vid) || [];

    let vtt = "WEBVTT\n\n";

    if (segments.length === 0) {
        vtt += `00:00:00.000 --> 00:00:05.000\nNo skip segments found.\n\n`;
    } else {
        segments.forEach(seg => {
            const start = toVTTTime(seg.start);
            const end = toVTTTime(seg.end);
            const label = seg.category || 'Intro';
            vtt += `${start} --> ${end}\n[${label}] ⏭️ Skipping...\n\n`;
        });
    }

    res.set('Content-Type', 'text/vtt');
    res.send(vtt);
});

// HLS Media Playlist Endpoint (Formerly manifest.m3u8)
app.get('/hls/manifest.m3u8', async (req, res) => {
    const { stream, start: startStr, end: endStr, id: videoId, user: userId } = req.query;

    if (!stream || !isSafeUrl(decodeURIComponent(stream))) {
        return res.status(400).send("Invalid or unsafe stream URL");
    }

    // --- AUTHENTICATED TELEMETRY ---
    const rdKey = req.query.rdKey;
    if (videoId && userId && rdKey) {
        const telemetryKey = `${userId}:${videoId}`;
        if (!global.loggedHistory?.[telemetryKey]) {
            try {
                // Verify RD Key before updating stats/history
                await axios.get('https://api.real-debrid.com/rest/1.0/user', {
                    headers: { 'Authorization': `Bearer ${rdKey}` },
                    timeout: 2000
                });

                if (!global.loggedHistory) global.loggedHistory = {};
                global.loggedHistory[telemetryKey] = Date.now();

                console.log(`[Telemetry] Play logged for ${userId.substr(0, 6)} on ${videoId}`);

                // Log to history
                userService.addWatchHistory(userId, {
                    videoId: videoId,
                    skip: { start: parseFloat(startStr), end: parseFloat(endStr) }
                });

                userService.updateUserStats(userId, {
                    votes: 1,
                    videoId: videoId
                });
            } catch (e) {
                console.warn(`[Telemetry] Auth failed for ${userId.substr(0, 6)}: ${e.message}`);
            }

            // GC old history logs every hour
            if (global.loggedHistory && Object.keys(global.loggedHistory).length > 2000) {
                const cutoff = Date.now() - 3600000;
                for (const k in global.loggedHistory) {
                    if (global.loggedHistory[k] < cutoff) delete global.loggedHistory[k];
                }
            }
        }
    }

    try {
        let streamUrl = decodeURIComponent(stream);
        const introStart = parseFloat(startStr) || 0;
        const introEnd = parseFloat(endStr) || 0;

        // Cache Key
        const cacheKey = `${streamUrl}_${introStart}_${introEnd}`;
        if (manifestCache.has(cacheKey)) {
            // console.log(`[HLS] Serving cached manifest for ${introStart}s - ${introEnd}s`);
            res.set('Content-Type', 'application/vnd.apple.mpegurl');
            return res.send(manifestCache.get(cacheKey));
        }

        console.log(`[HLS] Generating manifest for Intro: ${introStart}s - ${introEnd}s`);

        // 0. Resolve Redirects & Get Length
        console.log(`[HLS] Probing URL: ${streamUrl}`);
        const details = await getStreamDetails(streamUrl);
        if (details.finalUrl !== streamUrl) {
            console.log(`[HLS] Resolved Redirect: ${details.finalUrl}`);
            streamUrl = details.finalUrl;
        }
        const totalLength = details.contentLength;
        console.log(`[HLS] Content-Length: ${totalLength || 'Unknown'}`);

        // 0.5 Check for Invalid/Error Streams (e.g. failed_opening_v2.mp4)
        // If the file is < 15MB or has "failed_opening" in the URL, it's likely an error video.
        // We should just redirect to it so the user sees the error.
        const URL_LOWER = streamUrl.toLowerCase();
        if (URL_LOWER.includes('failed_opening')) {
            console.warn(`[HLS] Detected error stream (URL: ...${streamUrl.slice(-20)}). Bypassing proxy.`);
            return res.redirect(streamUrl);
        }

        let manifest = "";
        let isSuccess = false;

        // 1.5 Try Chapter Discovery if no skip segments provided
        if ((!introStart || introStart === 0) && (!introEnd || introEnd === 0)) {
            console.log(`[HLS] No skip segments for ${videoId}. Checking chapters...`);
            const chapters = await getChapters(streamUrl);
            const skipChapter = chapters.find(c => {
                const t = c.title.toLowerCase();
                return t.includes('intro') || t.includes('opening') || t === 'op';
            });

            if (skipChapter) {
                console.log(`[HLS] Found intro chapter: ${skipChapter.title} (${skipChapter.startTime}-${skipChapter.endTime}s)`);

                // Use these for the manifest
                const cStart = skipChapter.startTime;
                const cEnd = skipChapter.endTime;

                // BACKFILL: Fire and forget submission to DB
                if (videoId && userId) {
                    console.log(`[HLS] Backfilling chapter data for ${videoId} as 'chapter-bot'`);
                    skipService.addSkipSegment(videoId, cStart, cEnd, "Intro", "chapter-bot")
                        .catch(e => console.error(`[HLS] Backfill failed: ${e.message}`));
                }

                // Proceed with splicing using these values
                const points = await getRefinedOffsets(streamUrl, cStart, cEnd);
                if (points) {
                    manifest = generateSpliceManifest(streamUrl, 7200, points.startOffset, points.endOffset, totalLength);
                    isSuccess = true;
                }
            }
        }

        // 1. Get Offsets (Start & End)
        // If we have both, we try to splice
        if (!isSuccess && introStart > 0 && introEnd > introStart) {
            const points = await getRefinedOffsets(streamUrl, introStart, introEnd);
            if (points) {
                console.log(`[HLS] Splicing at bytes: ${points.startOffset} -> ${points.endOffset}`);
                manifest = generateSpliceManifest(streamUrl, 7200, points.startOffset, points.endOffset, totalLength);
                isSuccess = true;
            } else {
                console.warn("[HLS] Failed to find splice points. Falling back to simple skip.");
            }
        }

        // Fallback or Simple Skip (Start at X)
        if (!manifest) {
            const startTime = introEnd || introStart;
            // Only try if startTime is valid
            if (startTime > 0) {
                const offset = await getByteOffset(streamUrl, startTime);

                if (offset > 0) {
                    manifest = generateSmartManifest(streamUrl, 7200, offset, totalLength, startTime);
                    isSuccess = true;
                } else {
                    console.warn(`[HLS] Failed to find offset for ${startTime}s. Returning non-skipping stream.`);
                    // We DO NOT cache this failure, so we can retry later
                }
            }
        }

        // If all logic failed, just return the original stream as a pass-through manifest
        if (!manifest || !isSuccess) {
            console.log(`[HLS] No valid skip points found. Generating pass-through manifest for: ...${streamUrl.slice(-30)}`);
            // Create a manifest that just plays the whole file (0 to end)
            // Using 0 as startTime ensures generateSmartManifest doesn't try to splice
            manifest = generateSmartManifest(streamUrl, 7200, 0, totalLength, 0);
            isSuccess = true;
        }

        // Store in Cache - We cache even "failed" or pass-through manifests to prevent spamming ffprobe
        manifestCache.set(cacheKey, manifest);

        // 3. Serve
        res.set('Content-Type', 'application/vnd.apple.mpegurl');
        res.send(manifest);

    } catch (e) {
        console.error("Proxy Error:", e.message);
        // If an error occurs, we still redirect to the original stream
        console.log("Fallback: Redirecting to original stream (Error-based redirect)");
        res.redirect(req.query.stream);
    }
});

// 7. Voting Tracks: Side-effect endpoints
// Voting Actions Redirects
app.get('/vote/:action/:videoId', (req, res) => {
    const { action, videoId } = req.params;
    const { stream, start, end, user } = req.query; // stream is encoded URL
    const protocol = req.protocol;
    const host = req.get('host');
    const baseUrl = `${protocol}://${host}`;

    const userId = user || 'anonymous';
    console.log(`[Vote] User ${userId.substr(0, 6)}... voted ${action.toUpperCase()} on ${videoId}`);

    // Track vote for specific user
    userService.updateUserStats(userId, {
        votes: 1,
        videoId: videoId // Explicitly pass videoId as videoId for the list check
    });

    if (action === 'down') {
        // Downvote -> Redirect to ORIGINAL stream (No skipping)
        // We decode it because Stremio needs the real URL now
        const originalUrl = decodeURIComponent(stream);
        console.log(`[Vote] Redirecting to original: ${originalUrl}`);
        res.redirect(originalUrl);
    } else {
        // Upvote -> Redirect to SKIPPING stream
        const proxyUrl = `${baseUrl}/hls/manifest.m3u8?stream=${stream}&start=${start}&end=${end}`;
        console.log(`[Vote] Redirecting to skip: ${proxyUrl}`);
        res.redirect(proxyUrl);
    }
});

// Serve Addon
// Serve Addon - Handled by custom routes above
// app.use('/', addonRouter); // DEPRECATED

// 404 Handler (Last Route)
app.use((req, res) => {
    res.status(404).json({ error: "IntroHater Lite: Route not found", path: req.path });
});

if (require.main === module) {
    loadMetadataCache().then(() => {
        // Start Indexer
        try {
            indexerService.start();
        } catch (e) { console.error("Failed to start indexer:", e); }

        app.listen(PORT, () => {
            console.log(`IntroHater Lite running on ${PORT} (${PUBLIC_URL})`);
        });
    });
}

module.exports = app;

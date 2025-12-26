/**
 * API Routes
 * Handles all /api/* endpoints
 */

const express = require('express');
const router = express.Router();
const axios = require('axios');

const skipService = require('../services/skip-service');
const catalogService = require('../services/catalog');
const userService = require('../services/user-service');
const cacheService = require('../services/cache-service');
const { generateUserId, requireRdAuth } = require('../middleware/rdAuth');
const { generateUserToken, verifyUserToken } = require('../utils/auth');
const { STATS } = require('../config/constants');
const swaggerSpec = require('../config/swagger-config');

// ==================== Swagger Endpoint ====================

/**
 * @swagger
 * /api/swagger.json:
 *   get:
 *     tags:
 *       - Public
 *     summary: Get OpenAPI specification
 *     description: Returns the auto-generated OpenAPI 3.0 specification
 *     responses:
 *       200:
 *         description: OpenAPI specification
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 */
router.get('/swagger.json', (req, res) => {
    res.json(swaggerSpec);
});

// ==================== Stats Management ====================

let globalStats = {
    users: 0,
    skips: STATS.ANISKIP_ESTIMATE,
    savedTime: 0,
    votes: 0,
    segments: 0,
    showCount: 0,
    episodeCount: 0,
    sources: { local: 0, aniskip: STATS.ANISKIP_ESTIMATE, animeSkip: 0 }
};

const { performance } = require('perf_hooks');

async function refreshGlobalStats() {
    const start = performance.now();
    try {
        console.log(`[Stats] [${new Date().toISOString()}] Refreshing global stats...`);

        const [userStats, localSegmentCount, animeSkipRes, catalogStats] = await Promise.all([
            userService.getStats().catch(e => { console.warn("[Stats] User stats failed:", e.message); return {}; }),
            skipService.getSegmentCount().catch(e => { console.warn("[Stats] Segment count failed:", e.message); return 0; }),
            axios.post('https://api.anime-skip.com/graphql',
                { query: `query { counts { timestamps shows episodes } }` },
                {
                    headers: { 'X-Client-ID': 'th2oogUKrgOf1J8wMSIUPV0IpBMsLOJi' },
                    timeout: 5000
                }
            ).catch(e => { console.warn("[Stats] Anime-Skip failed:", e.message); return { data: { data: { counts: { timestamps: 0, shows: 0, episodes: 0 } } } }; }),
            catalogService.getCatalogStats().catch(e => { console.warn("[Stats] Catalog stats failed:", e.message); return { showCount: 0, episodeCount: 0 }; })
        ]);

        const { userCount = 0, voteCount = 0, totalSavedTime = 0 } = userStats;
        const animeSkipCount = animeSkipRes.data?.data?.counts?.timestamps || 0;
        const animeSkipShows = animeSkipRes.data?.data?.counts?.shows || 0;
        const animeSkipEpisodes = animeSkipRes.data?.data?.counts?.episodes || 0;

        globalStats = {
            users: userCount,
            skips: (localSegmentCount || 0) + STATS.ANISKIP_ESTIMATE + animeSkipCount,
            savedTime: totalSavedTime,
            votes: voteCount,
            segments: localSegmentCount || 0,
            showCount: (catalogStats.showCount || 0) + animeSkipShows,
            episodeCount: (catalogStats.episodeCount || 0) + animeSkipEpisodes,
            sources: {
                local: localSegmentCount || 0,
                aniskip: STATS.ANISKIP_ESTIMATE,
                animeSkip: animeSkipCount
            },
            lastUpdated: new Date().toISOString()
        };
        console.log(`[Stats] Global stats updated successfully. Total time: ${Math.round(performance.now() - start)}ms`);
    } catch (e) {
        console.error(`[Stats] Critical Refresh Failure:`, e);
    }
}

// Initial refresh and then every 15 minutes
refreshGlobalStats();
setInterval(refreshGlobalStats, STATS.REFRESH_INTERVAL_MS);

// ==================== API Endpoints ====================

/**
 * @swagger
 * /api/leaderboard:
 *   get:
 *     tags:
 *       - Public
 *     summary: Get user leaderboard
 *     description: Returns top 100 contributors ranked by segments and votes
 *     responses:
 *       200:
 *         description: Leaderboard data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 users:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/LeaderboardUser'
 *                 lastUpdated:
 *                   type: string
 *                   format: date-time
 */
router.get('/leaderboard', async (req, res) => {
    const board = await userService.getLeaderboard(100);
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

/**
 * @swagger
 * /api/activity:
 *   get:
 *     tags:
 *       - Public
 *     summary: Get recent activity
 *     description: Returns the 20 most recent segment additions for the live ticker
 *     responses:
 *       200:
 *         description: Array of recent activity items
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/ActivityItem'
 */
router.get('/activity', async (req, res) => {
    try {
        const recent = await skipService.getRecentSegments(50);

        const enriched = await Promise.all(recent.map(async (r) => {
            const parts = r.videoId.split(':');
            const imdbId = parts[0];
            const season = parts[1];
            const episode = parts[2];
            let title = imdbId;

            // Check cache first
            const cached = cacheService.getMetadata(imdbId);
            if (cached) {
                title = cached.Title;
            } else {
                try {
                    const show = await catalogService.getShowByImdbId(imdbId);
                    if (show && show.title) {
                        title = show.title;
                        cacheService.setMetadata(imdbId, { Title: show.title });
                    }
                } catch (e) { }
            }

            let episodeInfo = null;
            if (season && episode) {
                episodeInfo = `S${season}E${episode}`;
            }

            return {
                videoId: r.videoId,
                title: title,
                episode: episodeInfo,
                label: r.label || 'Intro',
                timestamp: r.createdAt || new Date()
            };
        }));

        // Deduplicate by videoId
        const seen = new Set();
        const deduplicated = enriched.filter(item => {
            if (seen.has(item.videoId)) return false;
            seen.add(item.videoId);
            return true;
        }).slice(0, 20);

        res.json(deduplicated);
    } catch (e) {
        console.error('[API] Activity error:', e.message);
        res.status(500).json([]);
    }
});

// Global Stats
router.get('/stats', (req, res) => {
    res.json(globalStats);
});

// Personal Stats
router.post('/stats/personal', requireRdAuth, async (req, res) => {
    try {
        const userId = req.userId;
        const stats = await userService.getUserStats(userId);

        if (stats) {
            const leaderboard = await userService.getLeaderboard(1000);
            const rank = leaderboard.findIndex(u => u.userId === userId) + 1;

            const enrichedHistory = await Promise.all((stats.watchHistory || []).slice(0, 15).map(async (item) => {
                const parts = item.videoId.split(':');
                const imdbId = parts[0];
                const season = parts[1];
                const episode = parts[2];

                let title = imdbId;
                let poster = null;

                const cached = cacheService.getMetadata(imdbId);
                if (cached) {
                    title = cached.Title;
                    poster = cached.Poster !== "N/A" ? cached.Poster : null;
                } else {
                    try {
                        const data = await catalogService.fetchMetadata(imdbId);
                        if (data) {
                            title = data.Title;
                            poster = data.Poster;
                            cacheService.setMetadata(imdbId, data);
                        }
                    } catch (e) { }
                }

                return {
                    ...item,
                    title: season && episode ? `${title} S${season}E${episode}` : title,
                    poster: poster
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

// Report Issue
router.post('/report', requireRdAuth, async (req, res) => {
    const { videoId, reason, segmentIndex } = req.body;
    if (!videoId) return res.status(400).json({ success: false, error: "Video ID required" });

    const userId = req.userId;
    console.log(`[Report] User ${userId.substr(0, 6)} reported ${videoId} (Seg: ${segmentIndex}): ${reason || 'No reason'}`);

    await skipService.reportSegment(videoId, segmentIndex || 0);
    await userService.updateUserStats(userId, { votes: -1, videoId: videoId });

    res.json({ success: true, message: "Issue reported. Thank you!" });
});

// Search (Proxy to OMDB)
router.get('/search', async (req, res) => {
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

// Submit Segment
router.post('/submit', requireRdAuth, async (req, res) => {
    const { imdbID, season, episode, start, end, label, applyToSeries } = req.body;
    if (!imdbID || start === undefined || end === undefined) {
        return res.status(400).json({ success: false, error: "Missing required fields" });
    }

    const userId = req.userId;

    let fullId = imdbID;
    if (season && episode && !imdbID.includes(':')) {
        fullId = `${imdbID}:${season}:${episode}`;
    }

    if (applyToSeries) {
        console.log(`[Submit] User ${userId.substr(0, 6)} submitted GLOBAL SERIES SKIP ${start}-${end}s for ${imdbID}`);
    } else {
        console.log(`[Submit] User ${userId.substr(0, 6)} submitted ${start}-${end}s for ${fullId}`);
    }

    const newSeg = await skipService.addSkipSegment(fullId, parseFloat(start), parseFloat(end), label || "Intro", userId, applyToSeries);
    await userService.updateUserStats(userId, { segments: 1 });

    res.json({ success: true, segment: newSeg });
});

// Generate Extension Token
router.post('/generate-token', async (req, res) => {
    const { userId, rdKey } = req.body;
    const apiKey = req.headers['x-api-key'];

    if (apiKey !== process.env.API_KEY && !rdKey) {
        return res.status(401).json({ error: "Unauthorized" });
    }

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
    res.json(tokenData);
});

// Track Skip (From Extension)
router.post('/track/skip', async (req, res) => {
    const { userId, token, duration } = req.body;

    if (!userId || !token || !duration) {
        return res.status(400).json({ error: "Missing required fields" });
    }

    const isValid = await verifyUserToken(userId, token);
    if (!isValid) {
        return res.status(401).json({ error: "Invalid or expired token" });
    }

    await userService.incrementSavedTime(userId, parseFloat(duration));
    res.json({ success: true });
});

// Admin: Get Pending Moderation
const ADMIN_PASS = process.env.ADMIN_PASSWORD;
router.post('/admin/pending', async (req, res) => {
    const { password } = req.body;
    if (password !== ADMIN_PASS) return res.status(401).json({ error: "Unauthorized" });

    const data = await skipService.getPendingModeration();

    const enrich = async (list) => {
        return Promise.all(list.map(async (item) => {
            const parts = item.fullId.split(':');
            const imdbId = parts[0];
            const season = parts[1];
            const episode = parts[2];

            let title = imdbId;
            const cached = cacheService.getMetadata(imdbId);
            if (cached) {
                title = cached.Title;
            }

            const displayTitle = season && episode ? `${title} S${season}E${episode}` : title;
            return { ...item, displayTitle, imdbId };
        }));
    };

    const pending = await enrich(data.pending);
    const reported = await enrich(data.reported);

    res.json({ pending, reported });
});

// Admin: Resolve Moderation
router.post('/admin/resolve', async (req, res) => {
    const { password, fullId, index, action } = req.body;
    if (password !== ADMIN_PASS) return res.status(401).json({ error: "Unauthorized" });

    const success = await skipService.resolveModeration(fullId, index, action);
    res.json({ success });
});

// Admin: Bulk Resolve
router.post('/admin/resolve-bulk', async (req, res) => {
    const { password, items, action } = req.body;
    if (password !== ADMIN_PASS) return res.status(401).json({ error: "Unauthorized" });
    if (!items || !Array.isArray(items)) return res.status(400).json({ error: "Invalid items" });

    const count = await skipService.resolveModerationBulk(items, action);
    res.json({ success: true, count });
});

// Catalog
router.get('/catalog', async (req, res) => {
    try {
        console.log("[API] Catalog Request Query:", JSON.stringify(req.query));
        const draw = parseInt(req.query.draw) || 1;
        const start = parseInt(req.query.start) || 0;
        const length = parseInt(req.query.length) || 1000;
        const search = req.query.search?.value || '';

        let sort = { title: 1 };
        const orderData = req.query.order;
        if (orderData) {
            let colIdx, dir;
            if (Array.isArray(orderData) && orderData[0]) {
                colIdx = parseInt(orderData[0].column);
                dir = orderData[0].dir === 'desc' ? -1 : 1;
            } else if (typeof orderData === 'object') {
                const firstOrder = orderData[0] || orderData;
                colIdx = parseInt(firstOrder.column);
                dir = firstOrder.dir === 'desc' ? -1 : 1;
            }

            if (colIdx !== undefined) {
                const colMap = ['title', 'year', 'totalSegments'];
                const field = colMap[colIdx] || 'title';
                sort = { [field]: dir };
            }
        }

        const page = Math.floor(start / length) + 1;
        const catalog = await catalogService.getCatalogData(page, length, search, sort);

        if (req.query.draw) {
            return res.json({
                draw: draw,
                recordsTotal: catalog.total || 0,
                recordsFiltered: catalog.filteredTotal || 0,
                data: Object.entries(catalog.media || {}).map(([id, item]) => [
                    item.title,
                    item.year,
                    item.episodes,
                    item.totalSegments,
                    id
                ])
            });
        }

        res.json(catalog);
    } catch (e) {
        console.error("[API] Catalog Error:", e);
        res.status(500).json({ error: "Failed to load catalog" });
    }
});

// Get Segments
router.get('/segments/:videoId', async (req, res) => {
    const list = await skipService.getSegments(req.params.videoId);
    res.json(list);
});

module.exports = router;

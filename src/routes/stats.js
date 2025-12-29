

const express = require('express');
const router = express.Router();

const skipService = require('../services/skip-service');
const catalogService = require('../services/catalog');
const userService = require('../services/user-service');
const cacheService = require('../services/cache-service');
const { requireRdAuth } = require('../middleware/rdAuth');
const { STATS } = require('../config/constants');



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
const axios = require('axios');

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


refreshGlobalStats();
setInterval(refreshGlobalStats, STATS.REFRESH_INTERVAL_MS);




router.get('/leaderboard', async (req, res) => {
    const board = await userService.getLeaderboard(100);
    res.json({
        users: board.map((u, i) => ({
            rank: i + 1,
            userId: u.userId ? u.userId.substring(0, 8) + '...' : 'anonymous',
            segments: u.segments,
            votes: u.votes,
            savedTime: u.savedTime || 0
        })),
        lastUpdated: new Date().toISOString()
    });
});


router.get('/activity', async (req, res) => {
    try {
        const recent = await skipService.getRecentSegments(50);

        const enriched = await Promise.all(recent.map(async (r) => {
            const parts = r.videoId.split(':');
            const imdbId = parts[0];
            const season = parts[1];
            const episode = parts[2];
            let title = imdbId;

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
                } catch {  }
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


router.get('/stats', (req, res) => {
    res.json(globalStats);
});


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
                    } catch {  }
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

module.exports = router;

const express = require('express');
const router = express.Router();
const axios = require('axios');

const skipService = require('../services/skip-service');
const cacheService = require('../services/cache-service');

const ADMIN_PASS = process.env.ADMIN_PASSWORD;

// Admin: Get Pending Moderation
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

            // Try cache first
            const cached = cacheService.getMetadata(imdbId);
            if (cached) {
                title = cached.Title;
            } else {
                // Fetch from Cinemeta if not cached
                try {
                    const metaRes = await axios.get(`https://v3-cinemeta.strem.io/meta/series/${imdbId}.json`, { timeout: 5000 });
                    if (metaRes.data?.meta?.name) {
                        title = metaRes.data.meta.name;
                        // Cache for future requests
                        cacheService.setMetadata(imdbId, { Title: title });
                    }
                } catch {
                    // Try movie endpoint if series fails
                    try {
                        const movieRes = await axios.get(`https://v3-cinemeta.strem.io/meta/movie/${imdbId}.json`, { timeout: 5000 });
                        if (movieRes.data?.meta?.name) {
                            title = movieRes.data.meta.name;
                            cacheService.setMetadata(imdbId, { Title: title });
                        }
                    } catch { /* Keep imdbId as fallback */ }
                }
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

module.exports = router;

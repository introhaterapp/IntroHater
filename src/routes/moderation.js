const express = require('express');
const router = express.Router();
const axios = require('axios');

const skipService = require('../services/skip-service');
const cacheService = require('../services/cache-service');

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
            } else {

                try {
                    const metaRes = await axios.get(`https://v3-cinemeta.strem.io/meta/series/${imdbId}.json`, { timeout: 5000 });
                    if (metaRes.data?.meta?.name) {
                        title = metaRes.data.meta.name;

                        cacheService.setMetadata(imdbId, { Title: title });
                    }
                } catch {

                    try {
                        const movieRes = await axios.get(`https://v3-cinemeta.strem.io/meta/movie/${imdbId}.json`, { timeout: 5000 });
                        if (movieRes.data?.meta?.name) {
                            title = movieRes.data.meta.name;
                            cacheService.setMetadata(imdbId, { Title: title });
                        }
                    } catch { }
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


router.post('/admin/resolve', async (req, res) => {
    const { password, fullId, index, action } = req.body;
    if (password !== ADMIN_PASS) return res.status(401).json({ error: "Unauthorized" });

    const success = await skipService.resolveModeration(fullId, index, action);
    res.json({ success });
});


router.post('/admin/resolve-bulk', async (req, res) => {
    const { password, items, action } = req.body;
    if (password !== ADMIN_PASS) return res.status(401).json({ error: "Unauthorized" });
    if (!items || !Array.isArray(items)) return res.status(400).json({ error: "Invalid items" });

    const count = await skipService.resolveModerationBulk(items, action);
    res.json({ success: true, count });
});


const indexerService = require('../services/indexer');


router.post('/admin/indexer/status', async (req, res) => {
    const { password } = req.body;
    if (password !== ADMIN_PASS) return res.status(401).json({ error: "Unauthorized" });

    try {
        const state = await indexerService.getIntroDBState();
        res.json(state);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});


router.post('/admin/indexer/trigger', async (req, res) => {
    const { password } = req.body;
    if (password !== ADMIN_PASS) return res.status(401).json({ error: "Unauthorized" });

    try {
        const result = await indexerService.triggerIntroDBIndex();
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});


router.post('/admin/indexer/reset', async (req, res) => {
    const { password } = req.body;
    if (password !== ADMIN_PASS) return res.status(401).json({ error: "Unauthorized" });

    try {
        const result = await indexerService.resetIntroDBState();
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});


const bannerRepository = require('../repositories/banner.repository');

router.get('/banner', async (req, res) => {
    try {
        const config = await bannerRepository.getBannerConfig();
        res.json(config);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/admin/banner/update', async (req, res) => {
    const { password, message, level, enabled } = req.body;
    if (password !== ADMIN_PASS) return res.status(401).json({ error: "Unauthorized" });

    try {
        const config = await bannerRepository.updateBannerConfig(message, level, enabled);
        res.json({ success: true, config });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;


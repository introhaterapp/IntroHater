

const express = require('express');
const router = express.Router();
const axios = require('axios');

const skipService = require('../services/skip-service');
const catalogService = require('../services/catalog');
const log = require('../utils/logger').api;
const scraperHealth = require('../services/scraper-health');
const swaggerSpec = require('../config/swagger-config');
const { searchWithProvider } = require('../utils/data-provider');
const { verifyDebridKey, getProvider } = require('../middleware/debridAuth');

const statsRoutes = require('./stats');
const moderationRoutes = require('./moderation');
const submissionsRoutes = require('./submissions');




router.get('/swagger.json', (req, res) => {
    res.json(swaggerSpec);
});

router.get('/status', (req, res) => {
    console.log(`[API] Health status request from ${req.ip}`);
    res.json(scraperHealth.getStatus());
});



router.use('/', statsRoutes);
router.use('/', moderationRoutes);
router.use('/', submissionsRoutes);




router.post('/validate-config', async (req, res) => {
    const { provider = 'realdebrid', debridKey, scraperUrl } = req.body || {};

    const checks = {
        debrid: { ok: false, message: 'Debrid API key required' },
        scraper: { ok: false, message: 'Stream source URL required' }
    };

    if (debridKey) {
        const providerConfig = getProvider(provider);
        const valid = await verifyDebridKey(provider, debridKey);
        checks.debrid = valid
            ? { ok: true, message: `${providerConfig?.name || 'Debrid'} API key verified` }
            : { ok: false, message: `Invalid ${providerConfig?.name || 'debrid'} API key` };
    }

    if (scraperUrl) {
        try {
            let url = scraperUrl.trim();
            if (!url.startsWith('http')) {
                checks.scraper = { ok: false, message: 'Stream source must be an https URL' };
            } else {
                if (!url.endsWith('/manifest.json')) {
                    url = url.replace(/\/$/, '') + '/manifest.json';
                }
                const response = await axios.get(url, { timeout: 8000 });
                const manifest = response.data;
                if (manifest && (manifest.id || manifest.name)) {
                    checks.scraper = {
                        ok: true,
                        message: `Connected to ${manifest.name || manifest.id}`
                    };
                } else {
                    checks.scraper = {
                        ok: false,
                        message: 'URL responded but does not look like a Stremio addon manifest'
                    };
                }
            }
        } catch {
            checks.scraper = {
                ok: false,
                message: 'Could not reach stream source — check your AIOstreams manifest URL'
            };
        }
    }

    res.json({
        valid: checks.debrid.ok && checks.scraper.ok,
        checks
    });
});


router.get('/search', async (req, res) => {
    const { q } = req.query;
    if (!q) return res.json({ Search: [] });

    try {
        const results = await searchWithProvider(q);
        res.json(results);
    } catch {
        res.status(500).json({ error: "Search failed" });
    }
});


router.get('/catalog', async (req, res) => {
    try {
        log.info({ query: req.query }, "Catalog Request Query");
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
        log.error({ err: e }, "Catalog Error");
        res.status(500).json({ error: "Failed to load catalog" });
    }
});


router.get('/segments/:videoId', async (req, res) => {
    const list = await skipService.getSegments(req.params.videoId);
    res.json(list);
});

module.exports = router;

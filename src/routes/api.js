

const express = require('express');
const router = express.Router();
const axios = require('axios');

const skipService = require('../services/skip-service');
const catalogService = require('../services/catalog');
const log = require('../utils/logger').api;
const swaggerSpec = require('../config/swagger-config');

const statsRoutes = require('./stats');
const moderationRoutes = require('./moderation');
const submissionsRoutes = require('./submissions');




router.get('/swagger.json', (req, res) => {
    res.json(swaggerSpec);
});



router.use('/', statsRoutes);
router.use('/', moderationRoutes);
router.use('/', submissionsRoutes);




router.get('/search', async (req, res) => {
    const { q } = req.query;
    const omdbKey = process.env.OMDB_API_KEY;
    if (!q || !omdbKey) return res.json({ Search: [] });

    try {
        const response = await axios.get(`https://www.omdbapi.com/?s=${encodeURIComponent(q)}&apikey=${omdbKey}`);
        res.json(response.data);
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

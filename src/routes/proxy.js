const express = require('express');
const router = express.Router();
const skipService = require('../services/skip-service');
const catalogService = require('../services/catalog');

function extractMetadataFromUrl(url, filename = '') {
    let imdbId = null;

    const imdbPattern = /tt\d{7,}/;
    const imdbMatch = url.match(imdbPattern);
    if (imdbMatch) {
        imdbId = imdbMatch[0];
    }

    let season = null;
    let episode = null;
    let showName = null;

    const source = filename || url;
    const seasonEpisodePattern = /S(\d{1,2})E(\d{1,2})/i;
    const match = source.match(seasonEpisodePattern);
    if (match) {
        season = parseInt(match[1], 10);
        episode = parseInt(match[2], 10);
    }

    try {
        const urlObj = new URL(url);
        const nameParam = urlObj.searchParams.get('name');
        if (nameParam) {
            showName = decodeURIComponent(nameParam);
        }
    } catch { }

    if (!showName && filename) {
        const nameMatch = filename.match(/^([^.]+(?:\.[^.]+)*?)\.S\d{1,2}E\d{1,2}/i);
        if (nameMatch) {
            showName = nameMatch[1].replace(/\./g, ' ').trim();
        }
    }

    return { imdbId, season, episode, showName };
}

router.get('/proxy/health', (req, res) => {
    res.json({
        status: 'ok',
        service: 'introhater-mediaflow-proxy',
        version: '1.0.0',
        public_id: 'introhater'
    });
});

router.get('/proxy/ip', (req, res) => {
    const clientIp = req.ip || req.connection.remoteAddress || 'unknown';
    res.json({
        ip: clientIp,
        public_id: 'introhater',
        proxy_url: `${req.protocol}://${req.get('host')}`
    });
});

router.get('/proxy/stream', async (req, res) => {
    const { d: destinationUrl, api_password, filename } = req.query;

    if (!destinationUrl) {
        return res.status(400).json({ error: 'Missing destination URL (d parameter)' });
    }

    const expectedPassword = process.env.PROXY_PASSWORD || 'introhater';
    if (api_password && api_password !== expectedPassword) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const decodedFilename = filename ? decodeURIComponent(filename) : '';
        let { imdbId, season, episode, showName } = extractMetadataFromUrl(destinationUrl, decodedFilename);

        if (!imdbId && showName && season && episode) {
            const show = await catalogService.getShowByTitle(showName);
            if (show) {
                imdbId = show.imdbId;
            }
        }

        let skipSegment = null;
        if (imdbId && season && episode) {
            const lookupId = `${imdbId}:${season}:${episode}`;
            skipSegment = await skipService.getSkipSegment(lookupId);

            if (skipSegment) {
                console.log(`[Proxy] 🎯 Skip for ${lookupId}: ${skipSegment.start}s-${skipSegment.end}s`);
            }
        }

        if (skipSegment) {
            console.log(`[Proxy] 🎯 Skip available for ${imdbId}:${season}:${episode}: ${skipSegment.start}s-${skipSegment.end}s (pass-through mode)`);
        }

        const decodedUrl = decodeURIComponent(destinationUrl);
        console.log(`[Proxy] 🔄 Redirecting to: ${decodedUrl.substring(0, 100)}...`);
        return res.redirect(decodedUrl);
    } catch (error) {
        console.error(`[Proxy] ❌ Error: ${error.message}`);
        return res.status(500).json({ error: 'Proxy error', message: error.message });
    }
});

router.post('/generate_urls', async (req, res) => {
    const { urls } = req.body;
    const firstItem = urls?.[0];
    let showName = '';

    if (firstItem?.destination_url) {
        try {
            const urlObj = new URL(firstItem.destination_url);
            showName = urlObj.searchParams.get('name') || '';
        } catch { }
    }

    console.log(`[Proxy] 📥 Batch: ${urls?.length || 0} URLs for "${showName || 'unknown'}"`);

    try {
        if (!urls || !Array.isArray(urls)) {
            console.error(`[Proxy] ❌ Invalid request: urls is ${typeof urls}`);
            return res.status(400).json({ error: 'Invalid request, expected urls array' });
        }

        const results = urls.map((item) => {
            const url = item.destination_url;
            const filename = item.filename || '';
            const endpoint = item.endpoint || '/proxy/stream';
            if (!url) return null;

            const protocol = req.protocol;
            const host = req.get('host');
            const baseUrl = `${protocol}://${host}`;

            const encodedUrl = encodeURIComponent(url);
            const encodedFilename = encodeURIComponent(filename);
            const password = req.body.api_password || '';

            return `${baseUrl}${endpoint}?d=${encodedUrl}&filename=${encodedFilename}&api_password=${encodeURIComponent(password)}`;
        }).filter(Boolean);

        console.log(`[Proxy] ✅ ${urls.length} → ${results.length} URLs wrapped`);
        res.json({ urls: results });
    } catch (error) {
        console.error(`[Proxy] ❌ Batch error: ${error.message}`);
        res.status(500).json({ error: 'Batch processing error', message: error.message });
    }
});

module.exports = router;

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
    const { d: destinationUrl, api_password } = req.query;

    if (!destinationUrl) {
        return res.status(400).json({ error: 'Missing destination URL (d parameter)' });
    }

    const expectedPassword = process.env.PROXY_PASSWORD || 'introhater';
    if (api_password && api_password !== expectedPassword) {
        console.log(`[Proxy] ⛔ Invalid password provided`);
        return res.status(401).json({ error: 'Unauthorized' });
    }

    console.log(`[Proxy] 📥 Request for: ${destinationUrl.substring(0, 100)}...`);

    try {
        const { imdbId, season, episode } = extractMetadataFromUrl(destinationUrl);
        console.log(`[Proxy] 🎬 Extracted: IMDb=${imdbId}, S${season}E${episode}`);

        let skipSegment = null;
        if (imdbId) {
            const lookupId = (season && episode) ? `${imdbId}:${season}:${episode}` : imdbId;
            skipSegment = await skipService.getSkipSegment(lookupId);

            if (skipSegment) {
                console.log(`[Proxy] 🎯 Skip found: ${skipSegment.start}s - ${skipSegment.end}s`);
            } else {
                console.log(`[Proxy] ℹ️ No skip segment for ${lookupId}`);
            }
        }

        if (skipSegment) {
            const protocol = req.protocol;
            const host = req.get('host');
            const baseUrl = `${protocol}://${host}`;

            const encodedStreamUrl = encodeURIComponent(destinationUrl);
            const start = skipSegment.start;
            const end = skipSegment.end;
            const id = imdbId || 'unknown';

            const hlsUrl = `${baseUrl}/hls/manifest.m3u8?stream=${encodedStreamUrl}&start=${start}&end=${end}&id=${id}&client=proxy`;

            console.log(`[Proxy] ✅ Redirecting to HLS with skips`);
            return res.redirect(hlsUrl);
        } else {
            console.log(`[Proxy] ⏭️ No skips, passing through to original URL`);
            return res.redirect(destinationUrl);
        }
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

        let lookupCount = 0;
        let firstSkipId = null;

        const results = await Promise.all(urls.map(async (item) => {
            const url = item.destination_url;
            const filename = item.filename || '';
            if (!url) return item;

            let { imdbId, season, episode, showName } = extractMetadataFromUrl(url, filename);

            if (!imdbId && showName && season && episode) {
                const show = await catalogService.getShowByTitle(showName);
                if (show) {
                    imdbId = show.imdbId;
                    lookupCount++;
                }
            }

            if (imdbId && season && episode) {
                const lookupId = `${imdbId}:${season}:${episode}`;
                const skipSegment = await skipService.getSkipSegment(lookupId);

                if (skipSegment) {
                    const protocol = req.protocol;
                    const host = req.get('host');
                    const baseUrl = `${protocol}://${host}`;

                    const encodedStreamUrl = encodeURIComponent(url);
                    const hlsUrl = `${baseUrl}/hls/manifest.m3u8?stream=${encodedStreamUrl}&start=${skipSegment.start}&end=${skipSegment.end}&id=${imdbId}&client=proxy`;

                    if (!firstSkipId) firstSkipId = lookupId;
                    return { ...item, destination_url: hlsUrl };
                }
            }

            return item;
        }));

        const modifiedCount = results.filter(r => r.destination_url && r.destination_url.includes('hls')).length;
        console.log(`[Proxy] ✅ ${urls.length} URLs → ${modifiedCount} with skips (${lookupCount} title lookups, first: ${firstSkipId || 'none'})`);
        res.json({ urls: results });
    } catch (error) {
        console.error(`[Proxy] ❌ Batch error: ${error.message}`);
        res.status(500).json({ error: 'Batch processing error', message: error.message });
    }
});

module.exports = router;

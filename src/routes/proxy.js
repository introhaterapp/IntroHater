const express = require('express');
const router = express.Router();
const skipService = require('../services/skip-service');

function extractMetadataFromUrl(url) {
    const imdbPattern = /tt\d{7,}/;
    const imdbMatch = url.match(imdbPattern);
    const imdbId = imdbMatch ? imdbMatch[0] : null;

    let season = null;
    let episode = null;

    const seasonEpisodePattern = /S(\d{1,2})E(\d{1,2})/i;
    const match = url.match(seasonEpisodePattern);
    if (match) {
        season = parseInt(match[1], 10);
        episode = parseInt(match[2], 10);
    }

    return { imdbId, season, episode };
}

router.get('/proxy/health', (req, res) => {
    res.json({
        status: 'ok',
        service: 'introhater-mediaflow-proxy',
        version: '1.0.0',
        public_id: 'introhater'
    });
});

router.get('/proxy/stream', async (req, res) => {
    const { d: destinationUrl } = req.query;

    if (!destinationUrl) {
        return res.status(400).json({ error: 'Missing destination URL (d parameter)' });
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

module.exports = router;

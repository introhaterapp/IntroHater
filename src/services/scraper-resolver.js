const axios = require('axios');
const { buildTorrentioUrl, buildCometUrl, buildMediaFusionUrl } = require('../middleware/debridAuth');
const debridResolver = require('./debrid-resolver');

async function resolveBestStream(provider, debridKey, type, id, priority, customUrl = null) {
    const scrapers = [];

    // 1. If user provided a custom scraper, prioritize it
    if (customUrl) {
        // Handle "stremio://" protocol which users might copy from install buttons
        let baseUrl = customUrl.trim();
        if (baseUrl.startsWith('stremio://')) {
            baseUrl = baseUrl.replace('stremio://', 'https://');
        }

        // Clean trailing slash
        baseUrl = baseUrl.replace(/\/$/, '');

        // If it points to manifest.json, strip it
        if (baseUrl.endsWith('/manifest.json')) {
            baseUrl = baseUrl.replace('/manifest.json', '');
        }

        scrapers.push({
            name: 'custom',
            builder: () => `${baseUrl}/stream/${type}/${id}.json`
        });
    }


    // 2. Fallback to standard scrapers if custom fails or isn't provided
    scrapers.push(
        { name: 'torrentio', builder: buildTorrentioUrl },
        { name: 'comet', builder: buildCometUrl },
        { name: 'mediafusion', builder: buildMediaFusionUrl }
    );


    const browserUserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

    // In deferred resolution, we try to find a stream matching the quality priority
    // 1-2: 4K, 3-5: 1080p, 6: 720p, 7: 480p

    for (const scraper of scrapers) {
        const url = scraper.builder(provider, debridKey, type, id);
        try {
            console.log(`[ScraperResolver] Resolving ${id} via ${scraper.name} (Priority ${priority})...`);
            const res = await axios.get(url, {
                timeout: 5000,
                headers: { 'User-Agent': browserUserAgent }
            });

            if (res.status === 200 && res.data.streams && res.data.streams.length > 0) {
                // Filter out rate limit messages
                const validStreams = res.data.streams.filter(s => {
                    const title = (s.title || s.name || '').toLowerCase();
                    return !title.includes('rate limit') && !title.includes('exceed');
                });

                if (validStreams.length === 0) continue;

                // Pick a stream based on priority
                // For now, let's just pick the first available one as quality filtering 
                // is complex due to varied title formats.
                // We'll improve this later.
                const bestStream = validStreams[0];

                let streamUrl = bestStream.url || bestStream.externalUrl;
                const infoHash = bestStream.infoHash || bestStream.infohash;

                if (!streamUrl && infoHash) {
                    console.log(`[ScraperResolver] Resolving infoHash: ${infoHash}`);
                    streamUrl = await debridResolver.resolveInfoHash(provider, debridKey, infoHash);
                }

                if (streamUrl) {
                    console.log(`[ScraperResolver] ✅ Resolved to: ${streamUrl.substring(0, 50)}...`);
                    return streamUrl;
                }
            }
        } catch (e) {
            console.error(`[ScraperResolver] ⚠️ ${scraper.name} error: ${e.message}`);
        }
    }

    return null;
}

module.exports = { resolveBestStream };

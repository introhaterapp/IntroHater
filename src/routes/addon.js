

const express = require('express');
const router = express.Router();
const path = require('path');
const axios = require('axios');

const scraperHealth = require('../services/scraper-health');
const skipService = require('../services/skip-service');
const {
    generateUserId,
    parseConfig,
    buildTorrentioUrl,
    buildCometUrl,
    buildMediaFusionUrl,
    getProvider
} = require('../middleware/debridAuth');
const { MANIFEST } = require('../config/constants');

const manifest = {
    id: MANIFEST.ID,
    version: MANIFEST.VERSION,
    name: MANIFEST.NAME,
    description: MANIFEST.DESCRIPTION,
    resources: ["stream"],
    types: ["movie", "series", "anime"],
    catalogs: [],
    behaviorHints: {
        configurable: true,
        configurationRequired: false
    }
};

async function handleStreamRequest(type, id, config, baseUrl, userAgent = '', origin = '') {
    const requestId = Date.now().toString(36);
    const isWebStremio = userAgent.includes('Stremio/Web') || origin.includes('strem.io') || origin.includes('stremio.com');
    const isAndroid = userAgent.toLowerCase().includes('android') || userAgent.toLowerCase().includes('exoplayer');
    const client = isWebStremio ? 'web' : (isAndroid ? 'android' : 'desktop');

    const { provider, key: debridKey } = parseConfig(config);
    const providerConfig = getProvider(provider);
    const providerName = providerConfig?.shortName || 'Debrid';

    if (!debridKey) {
        console.error(`[Stream ${requestId}] ❌ No debrid key provided`);
        return { streams: [] };
    }

    console.log(`[Stream ${requestId}] 📥 Request: ${type} ${id} (Client: ${client})`);
    console.log(`[Stream ${requestId}] 🔑 ${providerName} Key: ${debridKey.substring(0, 8)}...`);

    const scrapers = [
        { name: 'torrentio', label: 'Torrentio', builder: buildTorrentioUrl },
        { name: 'comet', label: 'Comet', builder: buildCometUrl },
        { name: 'mediafusion', label: 'MediaFusion', builder: buildMediaFusionUrl }
    ];

    let originalStreams = [];
    const browserUserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

    for (const scraper of scrapers) {
        const scraperUrl = scraper.builder(provider, debridKey, type, id);
        try {
            console.log(`[Stream ${requestId}] 🌐 Trying ${scraper.label}...`);
            const startTime = Date.now();

            const response = await axios.get(scraperUrl, {
                timeout: 8000,
                headers: {
                    'User-Agent': browserUserAgent,
                    'Accept': 'application/json, text/plain, */*',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Origin': 'https://web.stremio.com',
                    'Referer': 'https://web.stremio.com/'
                }
            });

            const latency = Date.now() - startTime;
            scraperHealth.updateStatus(scraper.name, 'online', latency);

            if (response.status === 200 && response.data.streams && response.data.streams.length > 0) {

                const firstStream = response.data.streams[0];
                const title = (firstStream.title || '').toLowerCase();
                if (title.includes('rate limit') || title.includes('public instance') || title.includes('donate')) {
                    console.warn(`[Stream ${requestId}] ⚠️ ${scraper.label} returned rate limit/public message. Skipping.`);
                    scraperHealth.updateStatus(scraper.name, 'degraded');
                    continue;
                }

                originalStreams = response.data.streams;
                console.log(`[Stream ${requestId}] ✅ ${scraper.label} responded with ${originalStreams.length} streams (${latency}ms)`);
                break;
            }
        } catch (e) {
            const status = parseInt(e.response?.status) || 0;
            const statusText = e.response?.statusText || e.code || 'Unknown';
            console.error(`[Stream ${requestId}] ⚠️ ${scraper.label} error: ${status || 'N/A'} ${statusText}`);

            scraperHealth.updateStatus(scraper.name, status === 403 ? 'blocked' : 'offline');
        }
    }

    if (originalStreams.length === 0) {
        console.error(`[Stream ${requestId}] ❌ All scrapers failed or returned no results`);
        console.error(`[Stream ${requestId}] 💡 This is an upstream issue with the scrapers, not IntroHater`);
    } else {
        const first = originalStreams[0];
        if (!first.url && (first.infoHash || first.infohash)) {
            console.warn(`[Stream ${requestId}] ⚠️ Scraper returned infoHashes but no URLs. Direct proxying requires resolved URLs.`);
        }
    }

    let skipSeg = null;
    try {
        skipSeg = await skipService.getSkipSegment(id);
        if (skipSeg) {
            console.log(`[Stream ${requestId}] 🎯 Skip segment found: ${skipSeg.start}s - ${skipSeg.end}s (${skipSeg.end - skipSeg.start}s duration)`);
        } else {
            console.log(`[Stream ${requestId}] 🔍 No skip segment for this content`);
        }
    } catch (e) {
        console.error(`[Stream ${requestId}] ⚠️ Skip lookup error: ${e.message}`);
    }

    const modifiedStreams = [];
    const userId = generateUserId(debridKey);

    originalStreams.forEach((stream) => {
        const streamUrl = stream.url || stream.externalUrl;
        const indicator = skipSeg ? "🚀" : "🔍";

        if (!streamUrl) {

            modifiedStreams.push({
                ...stream,
                title: `${indicator} [IntroHater*] ${stream.title || stream.name} (Direct)`,
            });
            return;
        }

        const encodedUrl = encodeURIComponent(streamUrl);
        const start = skipSeg ? skipSeg.start : 0;
        const end = skipSeg ? skipSeg.end : 0;

        const sanitizedStart = (typeof start === 'number' && !isNaN(start) && start >= 0) ? start : 0;
        const sanitizedEnd = (typeof end === 'number' && !isNaN(end) && end > sanitizedStart) ? end : sanitizedStart;

        const proxyUrl = `${baseUrl}/hls/manifest.m3u8?stream=${encodedUrl}&start=${sanitizedStart}&end=${sanitizedEnd}&id=${id}&user=${userId}&client=${client}&rdKey=${debridKey}`;

        modifiedStreams.push({
            ...stream,
            url: proxyUrl,
            title: `${indicator} [IntroHater] ${stream.title || stream.name}`,
            behaviorHints: {
                ...stream.behaviorHints || {},
                notWebReady: true
            }
        });
    });

    const finalStreams = modifiedStreams.slice(0, 100);
    console.log(`[Stream ${requestId}] 📊 Result: ${finalStreams.length} streams (truncated from ${modifiedStreams.length}), skip: ${skipSeg ? 'yes' : 'no'}`);
    return { streams: finalStreams };
}

router.get(['/configure', '/:config/configure'], (req, res) => {
    res.sendFile(path.join(__dirname, '../../docs', 'configure.html'));
});

router.get(['/:config/manifest.json', '/manifest.json'], (req, res) => {
    const config = req.params.config;
    const manifestClone = { ...manifest };

    if (config) {
        manifestClone.description += " (Configured)";
    }

    res.json(manifestClone);
});

router.get(['/:config/stream/:type/:id.json', '/stream/:type/:id.json'], async (req, res) => {
    res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.header('Pragma', 'no-cache');
    res.header('Expires', '0');

    const { config, type, id } = req.params;

    const fullConfig = config || process.env.RPDB_KEY;

    if (!fullConfig) {
        return res.json({ streams: [{ title: "⚠️ Configuration Required. Please reinstall addon.", url: "" }] });
    }

    const cleanId = id.replace('.json', '');
    const protocol = req.protocol;
    const host = req.get('host');
    const baseUrl = `${protocol}://${host}`;
    const userAgent = req.get('User-Agent') || '';
    const origin = req.get('Origin') || req.get('Referer') || '';

    const result = await handleStreamRequest(type, cleanId, fullConfig, baseUrl, userAgent, origin);
    res.json(result);
});

module.exports = router;

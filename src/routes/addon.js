

const express = require('express');
const router = express.Router();
const path = require('path');

const skipService = require('../services/skip-service');
const {
    generateUserId,
    parseConfig,
    getProvider
} = require('../middleware/debridAuth');



const { MANIFEST } = require('../config/constants');

const manifest = {
    id: MANIFEST.ID,
    version: MANIFEST.VERSION,
    name: MANIFEST.NAME,
    description: MANIFEST.DESCRIPTION,
    resources: MANIFEST.resources,
    types: MANIFEST.types,
    idPrefixes: MANIFEST.idPrefixes,
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

    const { provider, key: debridKey, scraper: externalScraper, proxyUrl, proxyPassword } = parseConfig(config);
    const providerConfig = getProvider(provider);
    const providerName = providerConfig?.shortName || 'Debrid';

    if (!debridKey) {
        console.error(`[Stream ${requestId}] ❌ No debrid key provided`);
        return { streams: [] };
    }

    console.log(`[Stream ${requestId}] 📥 Request: ${type} ${id} (Client: ${client})`);
    console.log(`[Stream ${requestId}] 🔑 ${providerName} Key: ${debridKey.substring(0, 8)}...`);
    if (externalScraper) console.log(`[Stream ${requestId}] 🌐 Using custom scraper: ${externalScraper.substring(0, 30)}...`);
    if (proxyUrl) console.log(`[Stream ${requestId}] 🛡️ Using proxy: ${proxyUrl}`);

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

    const userId = generateUserId(debridKey);
    const start = skipSeg ? skipSeg.start : 0;
    const end = skipSeg ? skipSeg.end : 0;
    const finalBaseUrl = baseUrl.replace('http://', 'https://');

    const scraperResolver = require('../services/scraper-resolver');

    console.log(`[Stream ${requestId}] 🔄 Resolving streams at browse time...`);

    let allStreams;
    try {
        allStreams = await scraperResolver.getAllStreams(provider, debridKey, type, id, externalScraper, proxyUrl, proxyPassword);
    } catch (e) {
        console.error(`[Stream ${requestId}] ❌ Error in getAllStreams: ${e.message}`);
        return {
            streams: [{
                name: "IntroHater",
                title: "⚠️ Scraper Error",
                description: `Failed to fetch streams: ${e.message}`,
                url: `${finalBaseUrl}/error/scraper-failed`
            }]
        };
    }

    if (!allStreams || allStreams.length === 0) {
        console.log(`[Stream ${requestId}] ❌ No streams found from any scraper`);
        return {
            streams: [{
                name: "IntroHater",
                title: "⚠️ No streams found",
                description: "Configure AIOstreams in the External Scraper field for reliable results.",
                url: `${finalBaseUrl}/error/no-streams`
            }]
        };
    }

    console.log(`[Stream ${requestId}] ✅ Found ${allStreams.length} streams from scraper`);

    const streams = allStreams.map(s => {
        const streamUrl = s.url || s.externalUrl;
        if (!streamUrl) return null;

        const encodedStreamUrl = encodeURIComponent(streamUrl);
        const hlsUrl = `${finalBaseUrl}/hls/manifest.m3u8?stream=${encodedStreamUrl}&start=${start}&end=${end}&id=${id}&user=${userId}&client=${client}&rdKey=${debridKey}&provider=${provider}`;

        const streamName = s.name || "IntroHater";
        const streamTitle = s.description
            ? `${s.title || s.name}${skipSeg ? ' 🎯' : ''}\n${s.description}`
            : `${s.title || s.name}${skipSeg ? ' 🎯' : ''}`;

        return {
            name: streamName,
            title: streamTitle,
            url: hlsUrl,
            behaviorHints: s.behaviorHints || {}
        };
    }).filter(Boolean);

    console.log(`[Stream ${requestId}] 📊 Returning ${streams.length} stream(s), skip: ${skipSeg ? 'yes' : 'no'}`);
    return { streams };
};




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

    const streamCount = result.streams?.length || 0;
    const previewStreams = result.streams?.slice(0, 3) || [];
    console.log(`[Stream ${cleanId}] 📤 Sending ${streamCount} stream(s). First 3:`, JSON.stringify({ streams: previewStreams }, null, 2));

    // Disable caching to debug visibility issues
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    res.json(result);

});


module.exports = router;

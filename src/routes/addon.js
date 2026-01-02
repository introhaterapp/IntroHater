

const express = require('express');
const router = express.Router();
const path = require('path');

const skipService = require('../services/skip-service');
const {
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

    const needsTranscoding = (isWebStremio || isAndroid) && provider === 'torbox';

    let proxyStreamCount = 0;
    const streams = allStreams.map(s => {
        const streamUrl = s.url || s.externalUrl;
        const infoHash = s.infoHash || s.infohash;

        if (!streamUrl && !infoHash) return null;

        const streamName = s.name || "IntroHater";
        const streamTitle = s.description
            ? `${s.title || s.name}${skipSeg ? ' 🎯' : ''}\n${s.description}`
            : `${s.title || s.name}${skipSeg ? ' 🎯' : ''}`;

        let playUrl;

        // Case 1: Needs Transcoding (TorBox + Web/Android) AND has InfoHash
        // We MUST prioritize generating a transcoded stream from InfoHash over using the provided direct URL (which is likely MKV)
        if (needsTranscoding && infoHash) {
            const skipParams = skipSeg ? `&start=${skipSeg.start}&end=${skipSeg.end}` : '';
            playUrl = `${finalBaseUrl}/hls/manifest.m3u8?infoHash=${infoHash}&id=${id}&user=${debridKey.substring(0, 8)}&provider=${provider}&rdKey=${debridKey}${skipParams}&transcode=true&client=${client}`;
        }
        // Case 2: Existing URL (Debrid Link or Direct)
        else if (streamUrl) {
            // Proxy streaming URLs (Comet /playback/, stremthru, mediafusion) normally pass directly
            // BUT if we have skip segments, route through HLS proxy for intro skipping
            const isProxyStream = streamUrl.includes('/playback/') ||
                streamUrl.toLowerCase().includes('stremthru') ||
                streamUrl.toLowerCase().includes('mediafusion');

            if (isProxyStream && !skipSeg) {
                // No skip segment - pass through directly for best compatibility
                proxyStreamCount++;
                playUrl = streamUrl;
            } else {
                // Has skip segment OR is not a proxy stream - route through HLS for skipping
                const encodedUrl = encodeURIComponent(streamUrl);
                const skipParams = skipSeg ? `&start=${skipSeg.start}&end=${skipSeg.end}` : '';
                playUrl = `${finalBaseUrl}/hls/manifest.m3u8?stream=${encodedUrl}&id=${id}&user=${debridKey.substring(0, 8)}&provider=${provider}&rdKey=${debridKey}${skipParams}&client=${client}`;
            }
        }
        // Case 3: InfoHash Only (TorBox Native / Other)
        else if (infoHash) {
            const skipParams = skipSeg ? `&start=${skipSeg.start}&end=${skipSeg.end}` : '';
            // Only add transcode param if needed (though logic above handles the forced case)
            const transcodeParam = needsTranscoding ? '&transcode=true' : '';
            playUrl = `${finalBaseUrl}/hls/manifest.m3u8?infoHash=${infoHash}&id=${id}&user=${debridKey.substring(0, 8)}&provider=${provider}&rdKey=${debridKey}${skipParams}${transcodeParam}&client=${client}`;
        }

        return {
            name: streamName,
            title: streamTitle,
            url: playUrl,
            behaviorHints: s.behaviorHints || {}
        };
    }).filter(Boolean);

    if (proxyStreamCount > 0) {
        console.log(`[Stream ${requestId}] 🔄 ${proxyStreamCount} streams without skips passed through directly`);
    }

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

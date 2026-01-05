

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
    const ua = userAgent.toLowerCase();
    const isAndroid = ua.includes('android') || ua.includes('exoplayer') || ua.includes('shield');
    const client = isWebStremio ? 'web' : (isAndroid ? 'android' : 'desktop');

    const { provider, key: debridKey, providers, scraper: externalScraper, proxyUrl, proxyPassword } = parseConfig(config);
    const providerConfig = getProvider(provider);
    const providerName = providerConfig?.shortName || 'Debrid';
    const providerCount = providers ? Object.keys(providers).length : 1;

    if (!debridKey) {
        console.error(`[Stream ${requestId}] ❌ No debrid key provided`);
        return { streams: [] };
    }

    console.log(`[Stream ${requestId}] 📥 Request: ${type} ${id} (Client: ${client})`);
    console.log(`[Stream ${requestId}] 🔑 Primary: ${providerName} Key: ${debridKey.substring(0, 8)}...${providerCount > 1 ? ` (+${providerCount - 1} secondary)` : ''}`);
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



    let proxyStreamCount = 0;
    const streams = allStreams.map(s => {
        const streamUrl = s.url || s.externalUrl;
        let infoHash = s.infoHash || s.infohash;

        if (!streamUrl && !infoHash) return null;

        const streamName = s.name || "IntroHater";
        const streamTitle = s.description
            ? `${s.title || s.name}${skipSeg ? ' 🎯' : ''}\n${s.description}`
            : `${s.title || s.name}${skipSeg ? ' 🎯' : ''}`;

        // Detect stream provider from name/title prefixes
        // Supports: [TB]/TorBox, [RD]/Real-Debrid, [PM]/Premiumize, [AD]/AllDebrid
        let effectiveProvider = provider;
        let effectiveKey = debridKey;

        if (providers) {
            const combinedText = `${streamName} ${s.title || ''}`;

            if ((combinedText.includes('[TB]') || combinedText.includes('[TB ') || combinedText.includes('TorBox')) && providers.torbox) {
                effectiveProvider = 'torbox';
                effectiveKey = providers.torbox;
            } else if ((combinedText.includes('[RD]') || combinedText.includes('[RD ') || combinedText.includes('Real-Debrid')) && providers.realdebrid) {
                effectiveProvider = 'realdebrid';
                effectiveKey = providers.realdebrid;
            } else if ((combinedText.includes('[PM]') || combinedText.includes('[PM ') || combinedText.includes('Premiumize')) && providers.premiumize) {
                effectiveProvider = 'premiumize';
                effectiveKey = providers.premiumize;
            } else if ((combinedText.includes('[AD]') || combinedText.includes('[AD ') || combinedText.includes('AllDebrid')) && providers.alldebrid) {
                effectiveProvider = 'alldebrid';
                effectiveKey = providers.alldebrid;
            }
        }

        // Determine transcoding need based on effective provider
        const effectiveNeedsTranscoding = (isWebStremio || isAndroid) && effectiveProvider === 'torbox';

        let playUrl;

        // Case 1: Needs Transcoding (TorBox + Web/Android) AND has InfoHash
        // We MUST prioritize generating a transcoded stream from InfoHash over using the provided direct URL (which is likely MKV)
        if (effectiveNeedsTranscoding && infoHash) {
            const skipParams = skipSeg ? `&start=${skipSeg.start}&end=${skipSeg.end}` : '';
            // Include original streamUrl as fallback for when TorBox doesn't have the torrent cached
            const fallbackParam = streamUrl ? `&fallback=${encodeURIComponent(streamUrl)}` : '';
            playUrl = `${finalBaseUrl}/hls/manifest.m3u8?infoHash=${infoHash}&id=${id}&user=${effectiveKey.substring(0, 8)}&provider=${effectiveProvider}&rdKey=${effectiveKey}${skipParams}&transcode=true&client=${client}${fallbackParam}`;
        }
        // Case 2: Existing URL (Debrid Link or Direct)
        else if (streamUrl) {
            // Attempt to extract InfoHash from Comet/Debrid URLs if missing
            // Comet uses /playback/{infoHash}/...
            if (!infoHash) {
                const cometHashMatch = streamUrl.match(/\/playback\/([a-fA-F0-9]{40})\//);
                if (cometHashMatch) {
                    infoHash = cometHashMatch[1];

                    // Re-evaluate transcoding need now that we have a hash
                    if (effectiveNeedsTranscoding) {
                        const skipParams = skipSeg ? `&start=${skipSeg.start}&end=${skipSeg.end}` : '';
                        // Include original streamUrl as fallback
                        const fallbackParam = `&fallback=${encodeURIComponent(streamUrl)}`;
                        playUrl = `${finalBaseUrl}/hls/manifest.m3u8?infoHash=${infoHash}&id=${id}&user=${effectiveKey.substring(0, 8)}&provider=${effectiveProvider}&rdKey=${effectiveKey}${skipParams}&transcode=true&client=${client}${fallbackParam}`;
                    }
                }
            }

            if (!playUrl) {
                // If we still don't have a transcode URL, proceed with standard proxy/direct logic
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
                    playUrl = `${finalBaseUrl}/hls/manifest.m3u8?stream=${encodedUrl}&id=${id}&user=${effectiveKey.substring(0, 8)}&provider=${effectiveProvider}&rdKey=${effectiveKey}${skipParams}&client=${client}`;
                }
            }
        }
        // Case 3: InfoHash Only (TorBox Native / Other)
        else if (infoHash) {
            const skipParams = skipSeg ? `&start=${skipSeg.start}&end=${skipSeg.end}` : '';
            // Only add transcode param if needed (though logic above handles the forced case)
            const transcodeParam = effectiveNeedsTranscoding ? '&transcode=true' : '';
            playUrl = `${finalBaseUrl}/hls/manifest.m3u8?infoHash=${infoHash}&id=${id}&user=${effectiveKey.substring(0, 8)}&provider=${effectiveProvider}&rdKey=${effectiveKey}${skipParams}${transcodeParam}&client=${client}`;
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

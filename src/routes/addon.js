

const express = require('express');
const router = express.Router();
const path = require('path');

const skipService = require('../services/skip-service');
const {
    parseConfig,
    getProvider
} = require('../middleware/debridAuth');
const { detectClient, isProxyStreamUrl, buildHlsManifestUrl } = require('../utils/client-detection');

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

function buildStreamOutputs(s, skipSeg, clientInfo, finalBaseUrl, id, effectiveKey, effectiveProvider) {
    const streamUrl = s.url || s.externalUrl;
    let infoHash = s.infoHash || s.infohash;
    const streamName = s.name || 'IntroHater';
    const baseTitle = s.title || s.name || streamName;
    const description = s.description || '';
    const outputs = [];

    if (!streamUrl && !infoHash) return outputs;

    const hlsParams = {
        id,
        userKeyPrefix: effectiveKey.substring(0, 8),
        provider: effectiveProvider,
        rdKey: effectiveKey,
        client: clientInfo.client,
        preferMp4: clientInfo.needsConstrainedPlayer,
        skipStart: skipSeg?.start,
        skipEnd: skipSeg?.end
    };

    if (skipSeg) {
        if (infoHash) {
            outputs.push({
                name: streamName,
                title: description
                    ? `${baseTitle} 🎯 Skip\n${description}`
                    : `${baseTitle} 🎯 Skip`,
                url: buildHlsManifestUrl(finalBaseUrl, { ...hlsParams, infoHash }),
                behaviorHints: { ...(s.behaviorHints || {}), notWebReady: clientInfo.needsConstrainedPlayer }
            });
        } else if (streamUrl) {
            if (!infoHash) {
                const cometHashMatch = streamUrl.match(/\/playback\/([a-fA-F0-9]{40})\//);
                if (cometHashMatch) infoHash = cometHashMatch[1];
            }

            if (infoHash) {
                outputs.push({
                    name: streamName,
                    title: description
                        ? `${baseTitle} 🎯 Skip\n${description}`
                        : `${baseTitle} 🎯 Skip`,
                    url: buildHlsManifestUrl(finalBaseUrl, {
                        ...hlsParams,
                        infoHash,
                        streamUrl
                    }) + (streamUrl ? `&fallback=${encodeURIComponent(streamUrl)}` : ''),
                    behaviorHints: { ...(s.behaviorHints || {}), notWebReady: clientInfo.needsConstrainedPlayer }
                });
            } else {
                outputs.push({
                    name: streamName,
                    title: description
                        ? `${baseTitle} 🎯 Skip\n${description}`
                        : `${baseTitle} 🎯 Skip`,
                    url: buildHlsManifestUrl(finalBaseUrl, { ...hlsParams, streamUrl }),
                    behaviorHints: { ...(s.behaviorHints || {}), notWebReady: clientInfo.needsConstrainedPlayer }
                });
            }

            if (clientInfo.needsConstrainedPlayer) {
                outputs.push({
                    name: streamName,
                    title: description
                        ? `${baseTitle} 📺 Direct (TV playback, no skip)\n${description}`
                        : `${baseTitle} 📺 Direct (TV playback, no skip)`,
                    url: streamUrl,
                    behaviorHints: s.behaviorHints || {}
                });
            }
        }
    } else {
        const isProxyStream = isProxyStreamUrl(streamUrl);

        if (isProxyStream) {
            outputs.push({
                name: streamName,
                title: description ? `${baseTitle}\n${description}` : baseTitle,
                url: streamUrl,
                behaviorHints: s.behaviorHints || {}
            });
        } else if (streamUrl) {
            outputs.push({
                name: streamName,
                title: description ? `${baseTitle}\n${description}` : baseTitle,
                url: buildHlsManifestUrl(finalBaseUrl, { ...hlsParams, streamUrl }),
                behaviorHints: s.behaviorHints || {}
            });
        } else if (infoHash) {
            outputs.push({
                name: streamName,
                title: description ? `${baseTitle}\n${description}` : baseTitle,
                url: buildHlsManifestUrl(finalBaseUrl, { ...hlsParams, infoHash }),
                behaviorHints: s.behaviorHints || {}
            });
        }
    }

    return outputs;
}

async function handleStreamRequest(type, id, config, baseUrl, userAgent = '', origin = '') {
    const requestId = Date.now().toString(36);
    const clientInfo = detectClient(userAgent, origin);

    const { provider, key: debridKey, providers, scraper: externalScraper, proxyUrl, proxyPassword } = parseConfig(config);
    const providerConfig = getProvider(provider);
    const providerName = providerConfig?.shortName || 'Debrid';
    const providerCount = providers ? Object.keys(providers).length : 1;

    if (!debridKey) {
        console.error(`[Stream ${requestId}] ❌ No debrid key provided`);
        return { streams: [] };
    }

    console.log(`[Stream ${requestId}] 📥 Request: ${type} ${id} (Client: ${clientInfo.client})`);
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
                description: externalScraper
                    ? "No streams returned. Verify your AIOStreams manifest URL and reinstall from the configure page."
                    : "Configure AIOstreams in the External Scraper field for reliable results.",
                url: `${finalBaseUrl}/error/no-streams`
            }]
        };
    }

    console.log(`[Stream ${requestId}] ✅ Found ${allStreams.length} streams from scraper`);

    let proxyStreamCount = 0;
    const streams = allStreams.flatMap(s => {
        const streamUrl = s.url || s.externalUrl;
        let infoHash = s.infoHash || s.infohash;

        if (!streamUrl && !infoHash) return [];

        let effectiveProvider = provider;
        let effectiveKey = debridKey;

        if (providers) {
            const streamName = s.name || 'IntroHater';
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

        const outputs = buildStreamOutputs(s, skipSeg, clientInfo, finalBaseUrl, id, effectiveKey, effectiveProvider);

        if (!skipSeg && streamUrl && isProxyStreamUrl(streamUrl)) {
            proxyStreamCount++;
        }

        return outputs;
    });

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

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    res.json(result);
});

module.exports = router;



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

    const { provider, key: debridKey } = parseConfig(config);
    const providerConfig = getProvider(provider);
    const providerName = providerConfig?.shortName || 'Debrid';

    if (!debridKey) {
        console.error(`[Stream ${requestId}] ❌ No debrid key provided`);
        return { streams: [] };
    }

    console.log(`[Stream ${requestId}] 📥 Request: ${type} ${id} (Client: ${client})`);
    console.log(`[Stream ${requestId}] 🔑 ${providerName} Key: ${debridKey.substring(0, 8)}...`);

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

    const indicator = skipSeg ? "🚀" : "🔍";
    const userId = generateUserId(debridKey);
    const start = skipSeg ? skipSeg.start : 0;
    const end = skipSeg ? skipSeg.end : 0;

    const qualityPresets = [
        { quality: '4K', label: '2160p REMUX', priority: 1 },
        { quality: '4K', label: '2160p', priority: 2 },
        { quality: '1080p', label: '1080p REMUX', priority: 3 },
        { quality: '1080p', label: '1080p BluRay', priority: 4 },
        { quality: '1080p', label: '1080p', priority: 5 },
        { quality: '720p', label: '720p', priority: 6 },
        { quality: '480p', label: '480p', priority: 7 }
    ];

    const streams = qualityPresets.map(preset => {
        const proxyUrl = `${baseUrl}/hls/manifest.m3u8?start=${start}&end=${end}&id=${id}&user=${userId}&client=${client}&rdKey=${debridKey}&provider=${provider}&quality=${preset.priority}`;

        return {
            name: `[${providerName}⚡] IntroHater ${preset.quality}`,
            title: `${indicator} [IntroHater] ${preset.label}${skipSeg ? ' • Skip Intro' : ''}`,
            description: `📺 ${preset.label}\n${skipSeg ? `⏭️ Skip: ${start}s - ${end}s\n` : ''}🔄 Stream resolved at play time`,
            url: proxyUrl,
            behaviorHints: {
                notWebReady: true,
                bingeGroup: `introhater|${preset.quality}`
            }
        };
    });

    console.log(`[Stream ${requestId}] 📊 Returning ${streams.length} deferred streams, skip: ${skipSeg ? 'yes' : 'no'}`);
    return { streams };
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

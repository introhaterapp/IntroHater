/**
 * Stremio Addon Routes
 * Handles manifest and stream handler endpoints
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const axios = require('axios');

const skipService = require('../services/skip-service');
const { generateUserId } = require('../middleware/rdAuth');
const { MANIFEST } = require('../config/constants');

// ==================== Manifest ====================

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

// ==================== Stream Handler ====================

async function handleStreamRequest(type, id, rdKey, baseUrl, strictMode = false) {
    if (!rdKey) {
        console.error("[Server] No RD Key provided.");
        return { streams: [] };
    }

    console.log(`[Server] Request for ${type} ${id}${strictMode ? ' (strict)' : ''}`);
    let originalStreams = [];
    let skipSeg = null;

    try {
        const torrentioUrl = `https://torrentio.strem.fun/providers=yts,eztv,rarbg,1337x,thepiratebay,kickasstorrents,torrentgalaxy,magnetdl,horriblesubs,nyaasi,tokyotosho,anidex,rutor,rutracker,torrent9,mejortorrent,wolfmax4k%7Csort=qualitysize%7Clanguage=korean%7Cqualityfilter=scr,cam%7Cdebridoptions=nodownloadlinks,nocatalog%7Crealdebrid=${rdKey}/stream/${type}/${id}.json`;

        const [torrentioResponse, skipResult] = await Promise.all([
            axios.get(torrentioUrl).catch(e => {
                console.error("Error fetching upstream:", e.message);
                return { status: 500, data: { streams: [] } };
            }),
            skipService.getSkipSegment(id).catch(e => {
                console.error("Error getting skip:", e.message);
                return null;
            })
        ]);

        if (torrentioResponse.status === 200 && torrentioResponse.data.streams) {
            originalStreams = torrentioResponse.data.streams;
            console.log(`[Server] Fetched ${originalStreams.length} streams from upstream`);
        }

        skipSeg = skipResult;
        if (skipSeg) {
            console.log(`[Server] Found skip for ${id}: ${skipSeg.start}-${skipSeg.end}s`);
        }
    } catch (e) {
        console.error("[Server] Stream Request Lifecycle Error:", e.message);
    }

    // STRICT MODE: If enabled and no skip segment found, return informative message
    if (strictMode && !skipSeg) {
        console.log(`[Server] Strict mode: No skip segment for ${id}, rejecting stream`);
        return {
            streams: [{
                title: "⚠️ [IntroHater Strict] No skip data available for this content",
                url: "",
                behaviorHints: { notWebReady: true }
            }]
        };
    }

    const modifiedStreams = [];

    originalStreams.forEach((stream) => {
        if (!stream.url) return;

        const encodedUrl = encodeURIComponent(stream.url);
        const userId = generateUserId(rdKey);

        const start = skipSeg ? skipSeg.start : 0;
        const end = skipSeg ? skipSeg.end : 0;

        const proxyUrl = `${baseUrl}/hls/manifest.m3u8?stream=${encodedUrl}&start=${start}&end=${end}&id=${id}&user=${userId}&rdKey=${rdKey}`;

        const indicator = skipSeg ? "🚀" : "🔍";

        modifiedStreams.push({
            ...stream,
            url: proxyUrl,
            title: `${indicator} [IntroHater] ${stream.title || stream.name}`,
            behaviorHints: { notWebReady: false }
        });
    });

    return { streams: modifiedStreams };
}

// ==================== Routes ====================

// Configure page
router.get(['/configure', '/:config/configure'], (req, res) => {
    res.sendFile(path.join(__dirname, '../../docs', 'configure.html'));
});

// Manifest
router.get(['/:config/manifest.json', '/manifest.json'], (req, res) => {
    const config = req.params.config;
    const manifestClone = { ...manifest };

    if (config) {
        manifestClone.description += " (Configured)";
    }

    res.json(manifestClone);
});

// Stream Handler
router.get(['/:config/stream/:type/:id.json', '/stream/:type/:id.json'], async (req, res) => {
    const { config, type, id } = req.params;

    // Parse config: format is "RDKEY" or "RDKEY-strict"
    let rdKey = config || process.env.RPDB_KEY;
    let strictMode = false;

    if (rdKey && rdKey.endsWith('-strict')) {
        strictMode = true;
        rdKey = rdKey.slice(0, -7); // Remove "-strict" suffix
    }

    if (!rdKey) {
        return res.json({ streams: [{ title: "⚠️ Configuration Required. Please reinstall addon.", url: "" }] });
    }

    const cleanId = id.replace('.json', '');
    const protocol = req.protocol;
    const host = req.get('host');
    const baseUrl = `${protocol}://${host}`;

    const result = await handleStreamRequest(type, cleanId, rdKey, baseUrl, strictMode);
    res.json(result);
});

module.exports = router;

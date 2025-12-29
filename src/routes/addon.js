

const express = require('express');
const router = express.Router();
const path = require('path');
const axios = require('axios');

const skipService = require('../services/skip-service');
const { generateUserId } = require('../middleware/rdAuth');
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



async function handleStreamRequest(type, id, rdKey, baseUrl) {
    const requestId = Date.now().toString(36); 

    if (!rdKey) {
        console.error(`[Stream ${requestId}] ❌ No RD Key provided`);
        return { streams: [] };
    }

    console.log(`[Stream ${requestId}] 📥 Request: ${type} ${id}`);
    console.log(`[Stream ${requestId}] 🔑 RD Key: ${rdKey.substring(0, 8)}...`);

    let originalStreams = [];
    let skipSeg = null;

    
    
    const torrentioUrl = `https://torrentio.strem.fun/providers=yts,eztv,rarbg,1337x,thepiratebay,kickasstorrents,torrentgalaxy,magnetdl,horriblesubs,nyaasi,tokyotosho,anidex,rutor,rutracker,torrent9,mejortorrent,wolfmax4k%7Csort=qualitysize%7Clanguage=korean%7Cqualityfilter=scr,cam%7Cdebridoptions=nodownloadlinks,nocatalog%7Crealdebrid=${rdKey}/stream/${type}/${id}.json`;

    
    const MAX_RETRIES = 3;
    const RETRY_DELAY = 1000;
    let torrentioResponse = null;
    let lastError = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            console.log(`[Stream ${requestId}] 🌐 Torrentio attempt ${attempt}/${MAX_RETRIES}...`);
            const startTime = Date.now();

            torrentioResponse = await axios.get(torrentioUrl, { timeout: 10000 });

            const elapsed = Date.now() - startTime;
            console.log(`[Stream ${requestId}] ✅ Torrentio responded: ${torrentioResponse.status} (${elapsed}ms)`);

            if (torrentioResponse.status === 200 && torrentioResponse.data.streams) {
                originalStreams = torrentioResponse.data.streams;
                console.log(`[Stream ${requestId}] 📦 Fetched ${originalStreams.length} streams from Torrentio+RD`);
                break; 
            }
        } catch (e) {
            lastError = e;
            const status = e.response?.status || 'N/A';
            const statusText = e.response?.statusText || e.code || 'Unknown';
            console.error(`[Stream ${requestId}] ⚠️ Torrentio error (attempt ${attempt}): ${status} ${statusText} - ${e.message}`);

            if (attempt < MAX_RETRIES) {
                console.log(`[Stream ${requestId}] ⏳ Retrying in ${RETRY_DELAY}ms...`);
                await new Promise(r => setTimeout(r, RETRY_DELAY));
            }
        }
    }

    if (originalStreams.length === 0 && lastError) {
        console.error(`[Stream ${requestId}] ❌ All ${MAX_RETRIES} Torrentio attempts failed`);
        console.error(`[Stream ${requestId}] 💡 This is an upstream issue with Torrentio/Real-Debrid, not IntroHater`);
    }

    
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

    
    console.log(`[Stream ${requestId}] 📊 Result: ${modifiedStreams.length} streams, skip: ${skipSeg ? 'yes' : 'no'}`);

    return { streams: modifiedStreams };
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
    const { config, type, id } = req.params;

    const rdKey = config || process.env.RPDB_KEY;

    if (!rdKey) {
        return res.json({ streams: [{ title: "⚠️ Configuration Required. Please reinstall addon.", url: "" }] });
    }

    const cleanId = id.replace('.json', '');
    const protocol = req.protocol;
    const host = req.get('host');
    const baseUrl = `${protocol}://${host}`;

    const result = await handleStreamRequest(type, cleanId, rdKey, baseUrl);
    res.json(result);
});

module.exports = router;

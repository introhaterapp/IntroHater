const axios = require('axios');
const { searchTorBox } = require('./torbox-scraper');
const { buildTorrentioUrl, buildCometUrl, buildMediaFusionUrl } = require('../middleware/debridAuth');
const debridResolver = require('./debrid-resolver');

async function resolveBestStream(provider, debridKey, type, id, priority, customUrl = null, proxyUrl = null, proxyPassword = null, options = {}) {
    // This function seems unused by the main addon flow (which uses getAllStreams), 
    // but we'll keep it for completeness and potential legacy/meta usage.
    // Simplifying to reuse getAllStreams logic if possible, or just a basic implementation.

    const streams = await getAllStreams(provider, debridKey, type, id, customUrl, proxyUrl, proxyPassword, options);
    // Logic to pick "best" stream? 
    // For now, let's just return the first one with a URL, or resolve the first one with an infoHash.

    if (!streams || streams.length === 0) return null;

    for (const stream of streams) {
        if (stream.url) return stream.url;
        if (stream.infoHash) {
            const resolved = await debridResolver.resolveInfoHash(provider, debridKey, stream.infoHash, options);
            if (resolved) return resolved;
        }
    }
    return null;
}

async function getAllStreams(provider, debridKey, type, id, customUrl = null, proxyUrl = null, proxyPassword = null, _options = {}) {
    const logPrefix = `[ScraperResolver]`;
    console.log(`${logPrefix} ========== GET ALL STREAMS ==========`);
    console.log(`${logPrefix} Provider: ${provider}, Type: ${type}, ID: ${id}`);
    if (proxyUrl) console.log(`${logPrefix} 🛡️ Proxy Enabled: ${proxyUrl}`);

    let allStreams = [];
    const scrapers = [];

    // 1. Custom scraper
    if (customUrl) {
        let baseUrl = customUrl.trim();
        if (baseUrl.startsWith('stremio://')) baseUrl = baseUrl.replace('stremio://', 'https://');
        if (baseUrl.startsWith('http://') && (baseUrl.includes('torrentio') || baseUrl.includes('comet') || baseUrl.includes('mediafusion'))) {
            baseUrl = baseUrl.replace('http://', 'https://');
        }
        baseUrl = baseUrl.replace(/\/$/, '');
        if (baseUrl.endsWith('/manifest.json')) baseUrl = baseUrl.replace('/manifest.json', '');

        const customBuilder = () => `${baseUrl}/stream/${type}/${id}.json`;
        scrapers.push({ name: 'custom', builder: customBuilder });
    }

    // 2. Standard Scrapers - ONLY if no custom scraper is configured
    // If custom is present (e.g., AIOStreams), skip standard scrapers since AIOStreams already aggregates them
    if (!customUrl) {
        scrapers.push(
            { name: 'torrentio', builder: buildTorrentioUrl },
            { name: 'comet', builder: buildCometUrl },
            { name: 'mediafusion', builder: buildMediaFusionUrl }
        );
    } else {
        console.log(`${logPrefix} 📡 Custom scraper configured, skipping fallback scrapers`);
    }

    // 3. TorBox Native Search
    if (provider === 'torbox') {
        console.log(`${logPrefix} ---- Searching TorBox Native ----`);
        try {
            const imdbId = id.split(':')[0];
            const tbResults = await searchTorBox(imdbId, debridKey);
            if (tbResults && tbResults.length > 0) {
                console.log(`${logPrefix} ✅ TorBox Native found ${tbResults.length} torrents`);
                // Convert to stream objects
                const tbStreams = tbResults.map(t => ({
                    name: '[TB] TorBox Native',
                    title: t.title || t.name,
                    infoHash: t.infoHash || t.hash,
                    behaviorHints: { bingeGroup: `torbox-${t.infoHash}` }
                }));
                allStreams.push(...tbStreams);
            }
        } catch (e) {
            console.error(`${logPrefix} TorBox Native Error: ${e.message}`);
        }
    }

    const browserUserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

    // Run Scrapers
    for (const scraper of scrapers) {
        // Skip fallback scrapers if we found TorBox native results? 
        // Maybe not, user might want options.

        // Skip fallback scrapers if custom scraper found results?
        // Let's run them all and aggregate.

        let url = scraper.builder(provider, debridKey, type, id);
        // Proxy logic
        if (proxyUrl) {
            const cleanProxyUrl = proxyUrl.replace(/\/$/, '');
            const encodedDest = encodeURIComponent(url);
            let proxyReqUrl = `${cleanProxyUrl}/proxy/stream?d=${encodedDest}`;
            if (proxyPassword) proxyReqUrl += `&api_password=${encodeURIComponent(proxyPassword)}`;
            proxyReqUrl += `&h_user-agent=${encodeURIComponent(browserUserAgent)}`;
            url = proxyReqUrl;
        }

        try {
            console.log(`${logPrefix} Fetching ${scraper.name}...`);
            const res = await axios.get(url, { timeout: 10000, headers: { 'User-Agent': browserUserAgent } });
            if (res.data && res.data.streams) {
                console.log(`${logPrefix} ✅ ${scraper.name} returned ${res.data.streams.length} streams`);
                allStreams.push(...res.data.streams);
            }
        } catch (e) {
            console.warn(`${logPrefix} ⚠️ ${scraper.name} failed: ${e.message}`);
        }
    }

    // Extract InfoHashes from URLs (Comet/Debrid) before filtering
    allStreams.forEach(s => {
        if (!s.infoHash && (s.url || s.externalUrl)) {
            const url = s.url || s.externalUrl;
            const match = url.match(/\/playback\/([a-fA-F0-9]{40})\//);
            if (match) {
                s.infoHash = match[1];
                // console.log(`${logPrefix} 🔍 Extracted InfoHash from URL: ${s.infoHash}`);
            }
        }
    });

    // Filter Streams
    const validStreams = allStreams.filter(s => {
        const title = (s.title || s.name || '').toLowerCase();
        const url = s.url || s.externalUrl;
        const infoHash = s.infoHash || s.infohash;

        if (title.includes('rate limit') || title.includes('exceed')) {
            console.log(`${logPrefix} 🗑️ Filtered (Rate Limit): ${title}`);
            return false;
        }
        if (title.includes('🚫') || title.includes('[no') || title.includes('error')) {
            console.log(`${logPrefix} 🗑️ Filtered (Error/No): ${title}`);
            return false;
        }
        if (!url && !infoHash) {
            console.log(`${logPrefix} 🗑️ Filtered (No URL/Hash): ${title}`);
            return false;
        }

        return true;
    });

    console.log(`${logPrefix} Total valid streams: ${validStreams.length}`);
    return validStreams;
}

module.exports = { resolveBestStream, getAllStreams };

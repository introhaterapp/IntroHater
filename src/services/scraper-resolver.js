const axios = require('axios');
const { buildTorrentioUrl, buildCometUrl, buildMediaFusionUrl } = require('../middleware/debridAuth');
const debridResolver = require('./debrid-resolver');

async function resolveBestStream(provider, debridKey, type, id, priority, customUrl = null) {
    const logPrefix = `[ScraperResolver]`;
    console.log(`${logPrefix} ========== START RESOLUTION ==========`);
    console.log(`${logPrefix} Provider: ${provider}, Type: ${type}, ID: ${id}, Priority: ${priority}`);
    console.log(`${logPrefix} Custom URL: ${customUrl ? customUrl.substring(0, 80) : 'none'}`);

    const scrapers = [];

    // 1. If user provided a custom scraper, prioritize it
    if (customUrl) {
        let baseUrl = customUrl.trim();
        console.log(`${logPrefix} Processing custom URL: ${baseUrl.substring(0, 80)}`);

        if (baseUrl.startsWith('stremio://')) {
            baseUrl = baseUrl.replace('stremio://', 'https://');
            console.log(`${logPrefix} Converted stremio:// to https://`);
        }

        baseUrl = baseUrl.replace(/\/$/, '');
        if (baseUrl.endsWith('/manifest.json')) {
            baseUrl = baseUrl.replace('/manifest.json', '');
        }

        const customBuilder = () => `${baseUrl}/stream/${type}/${id}.json`;
        console.log(`${logPrefix} Custom scraper URL: ${customBuilder()}`);
        scrapers.push({ name: 'custom', builder: customBuilder });
    }

    // 2. Fallback to standard scrapers
    scrapers.push(
        { name: 'torrentio', builder: buildTorrentioUrl },
        { name: 'comet', builder: buildCometUrl },
        { name: 'mediafusion', builder: buildMediaFusionUrl }
    );

    const browserUserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

    for (const scraper of scrapers) {
        const url = scraper.builder(provider, debridKey, type, id);
        console.log(`${logPrefix} ---- Trying ${scraper.name} ----`);
        console.log(`${logPrefix} Request URL: ${url.substring(0, 100)}...`);

        try {
            const res = await axios.get(url, {
                timeout: 8000,
                headers: { 'User-Agent': browserUserAgent }
            });

            console.log(`${logPrefix} Response status: ${res.status}`);
            console.log(`${logPrefix} Streams count: ${res.data?.streams?.length || 0}`);

            if (res.status === 200 && res.data.streams && res.data.streams.length > 0) {
                // Log first 3 streams for debugging
                console.log(`${logPrefix} First 3 streams:`);
                res.data.streams.slice(0, 3).forEach((s, i) => {
                    console.log(`${logPrefix}   [${i}] name: ${(s.name || '').substring(0, 30)}`);
                    console.log(`${logPrefix}   [${i}] title: ${(s.title || '').substring(0, 50)}`);
                    console.log(`${logPrefix}   [${i}] url: ${s.url || 'NONE'}`);
                    console.log(`${logPrefix}   [${i}] externalUrl: ${s.externalUrl || 'NONE'}`);
                    console.log(`${logPrefix}   [${i}] infoHash: ${s.infoHash || s.infohash || 'NONE'}`);
                });

                const validStreams = res.data.streams.filter(s => {
                    const title = (s.title || s.name || '').toLowerCase();
                    return !title.includes('rate limit') && !title.includes('exceed');
                });

                console.log(`${logPrefix} Valid streams after filter: ${validStreams.length}`);
                if (validStreams.length === 0) {
                    console.log(`${logPrefix} All streams filtered out, trying next scraper`);
                    continue;
                }

                const bestStream = validStreams[0];
                console.log(`${logPrefix} Selected stream: ${JSON.stringify(bestStream).substring(0, 200)}`);

                let streamUrl = bestStream.url || bestStream.externalUrl;
                const infoHash = bestStream.infoHash || bestStream.infohash;

                console.log(`${logPrefix} Stream URL (raw): ${streamUrl || 'NONE'}`);
                console.log(`${logPrefix} InfoHash: ${infoHash || 'NONE'}`);

                if (!streamUrl && infoHash) {
                    console.log(`${logPrefix} No URL, resolving infoHash via debrid...`);
                    streamUrl = await debridResolver.resolveInfoHash(provider, debridKey, infoHash);
                    console.log(`${logPrefix} Debrid resolved to: ${streamUrl || 'FAILED'}`);
                }

                if (streamUrl) {
                    console.log(`${logPrefix} ✅ FINAL URL: ${streamUrl}`);
                    console.log(`${logPrefix} ========== END RESOLUTION ==========`);
                    return streamUrl;
                } else {
                    console.log(`${logPrefix} ⚠️ No valid URL from ${scraper.name}`);
                }
            } else {
                console.log(`${logPrefix} No valid streams in response`);
            }
        } catch (e) {
            console.error(`${logPrefix} ⚠️ ${scraper.name} error: ${e.message}`);
            if (e.response) {
                console.error(`${logPrefix}   Status: ${e.response.status}`);
                console.error(`${logPrefix}   Data: ${JSON.stringify(e.response.data).substring(0, 200)}`);
            }
        }
    }

    console.log(`${logPrefix} ❌ All scrapers failed`);
    console.log(`${logPrefix} ========== END RESOLUTION ==========`);
    return null;
}

module.exports = { resolveBestStream };

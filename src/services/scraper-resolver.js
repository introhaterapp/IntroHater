const axios = require('axios');
const { searchTorBox } = require('./torbox-scraper');
const { buildTorrentioUrl, buildCometUrl, buildMediaFusionUrl } = require('../middleware/debridAuth');
const debridResolver = require('./debrid-resolver');

async function resolveBestStream(provider, debridKey, type, id, priority, customUrl = null, proxyUrl = null, proxyPassword = null) {
    const logPrefix = `[ScraperResolver]`;
    console.log(`${logPrefix} ========== START RESOLUTION ==========`);
    console.log(`${logPrefix} Provider: ${provider}, Type: ${type}, ID: ${id}, Priority: ${priority} `);
    console.log(`${logPrefix} Custom URL: ${customUrl ? customUrl.substring(0, 80) : 'none'} `);
    if (proxyUrl) console.log(`${logPrefix} 🛡️ Proxy Enabled: ${proxyUrl} `);

    const scrapers = [];

    // 1. If user provided a custom scraper, prioritize it
    if (customUrl) {
        let baseUrl = customUrl.trim();
        console.log(`${logPrefix} Processing custom URL: ${baseUrl.substring(0, 80)} `);

        if (baseUrl.startsWith('stremio://')) {
            baseUrl = baseUrl.replace('stremio://', 'https://');
            console.log(`${logPrefix} Converted stremio:// to https://`);
        }

        // Force HTTPS for known scrapers (HTTP URLs may be from old configs)
        if (baseUrl.startsWith('http://') && (
            baseUrl.includes('torrentio.strem.fun') ||
            baseUrl.includes('comet.') ||
            baseUrl.includes('mediafusion.')
        )) {
            baseUrl = baseUrl.replace('http://', 'https://');
            console.log(`${logPrefix} Upgraded HTTP to HTTPS`);
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

    // 3. SPECIAL: TorBox Native Search (No Rate Limits!)
    // Only if provider is torbox OR we have a torbox key (handled elsewhere? debridKey is for specific provider)
    // Actually, resolveBestStream receives 'provider' and 'debridKey'.
    // If provider is 'torbox', we can use searchTorBox.
    // If provider is 'realdebrid', we can't use TorBox search unless we have a TB key separately.
    // BUT we don't have separate TB key here, only the primary key.
    // So ONLY use TorBox search if provider == 'torbox'.

    // Wait, the user has RealDebrid BUT also provided a TB Key in a different context?
    // No, here we only have the active provider's key.
    // So if user selected "TorBox" in config, this will work natively.

    const browserUserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

    // NEW LOGIC: Try TorBox API first if provider is TorBox
    if (provider === 'torbox') {
        console.log(`${logPrefix} ---- Trying TorBox Native Search ----`);
        try {
            // Need to parse IMDb ID (tt1234567)
            const imdbId = id.split(':')[0];
            const streams = await searchTorBox(imdbId, debridKey);
            if (streams && streams.length > 0) {
                console.log(`${logPrefix} ✅ TorBox Native Search found ${streams.length} streams`);
                // Filter by episode if needed?
                // TorBox search returns torrents. We need to filter for the specific episode?
                // The searchTorBox function currently just returns torrents.
                // We'll trust DebridResolver to pick the right file from the torrent.

                // Oops, resolveBestStream expects to return a SINGLE stream object { url: ... }
                // My searchTorBox returns a list of stream objects { infoHash: ... }
                // We need to resolve that stream via DebridResolver.
                // Actually, resolveBestStream resolves the scraper result (list of streams) into a single stream.

                // Let's integrate TorBox search results into the flow.
                // We can fake a scraper response?
                const tbStreams = streams.map(s => ({
                    ...s,
                    name: `[TB] TorBox Native`,
                    behaviorHints: { bingeGroup: `torbox-native-${s.infoHash}` }
                }));

                // Log and process like other scrapers...
                // But we need to return ONE stream.

                // Let's just use the first valid one?
                if (tbStreams.length > 0) {
                    // Add to validStreams logic below
                    // For now, let's just use the loop logic for http scrapers.
                    const validStreams = tbStreams.filter(s => {
                        const name = (s.name || '').toLowerCase();
                        const title = (s.title || s.name || '').toLowerCase();
                        const url = s.url || s.externalUrl || '';
                        const infoHash = s.infoHash || s.infohash;

                        // Filter out rate limit messages
                        if (title.includes('rate limit') || title.includes('exceed')) {
                            console.log(`${logPrefix} ⛔ Filtered: rate limit message`);
                            return false;
                        }

                        // Filter out error streams (🚫 symbol in name)
                        if (name.includes('🚫') || name.includes('[no') || name.includes('error')) {
                            console.log(`${logPrefix} ⛔ Filtered: error stream indicator in name`);
                            return false;
                        }

                        // Must have either a valid URL or an infoHash
                        if (!url && !infoHash) {
                            console.log(`${logPrefix} ⛔ Filtered: no URL or infoHash`);
                            return false;
                        }

                        // If has URL, validate it's a real domain (not placeholder like comet.fast)
                        if (url && !infoHash) {
                            try {
                                const parsed = new URL(url);
                                // Check for known placeholder domains
                                if (parsed.hostname === 'comet.fast' ||
                                    parsed.hostname === 'error' ||
                                    !parsed.hostname.includes('.')) {
                                    console.log(`${logPrefix} ⛔ Filtered: invalid/placeholder URL domain: ${parsed.hostname}`);
                                    return false;
                                }

                                // Check for error/exception URLs (MediaFusion uses these)
                                if (parsed.pathname.includes('/exceptions/') ||
                                    parsed.pathname.includes('/error/') ||
                                    parsed.pathname.includes('invalid')) {
                                    console.log(`${logPrefix} ⛔ Filtered: error/exception URL path: ${parsed.pathname}`);
                                    return false;
                                }
                            } catch {
                                console.log(`${logPrefix} ⛔ Filtered: malformed URL: ${url}`);
                                return false;
                            }
                        }

                        // Filter out streams with error descriptions
                        const desc = (s.description || '').toLowerCase();
                        if (desc.includes('invalid') || desc.includes('error') || desc.includes('configuration')) {
                            console.log(`${logPrefix} ⛔ Filtered: error description detected`);
                            return false;
                        }

                        return true;
                    });

                    if (validStreams.length > 0) {
                        const bestStream = validStreams[0];
                        console.log(`${logPrefix} Selected TorBox stream: ${JSON.stringify(bestStream).substring(0, 200)}`);

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
                            console.log(`${logPrefix} ⚠️ No valid URL from TorBox Native Search`);
                        }
                    } else {
                        console.log(`${logPrefix} No valid streams from TorBox Native Search after filtering.`);
                    }
                }
            }
        } catch (e) {
            console.error(`${logPrefix} TorBox Search failed: ${e.message}`);
        }
    }

    for (const scraper of scrapers) {
        let url = scraper.builder(provider, debridKey, type, id);
        console.log(`${logPrefix} ---- Trying ${scraper.name} ----`);
        console.log(`${logPrefix} Original URL: ${url.substring(0, 100)}...`);

        // Proxy Logic
        if (proxyUrl) {
            try {
                // Ensure proxyUrl has no trailing slash
                const cleanProxyUrl = proxyUrl.replace(/\/$/, '');

                // Construct MediaFlow Proxy URL
                // /proxy/stream?d=DESTINATION_URL&api_password=PASSWORD
                const encodedDest = encodeURIComponent(url);
                let proxyReqUrl = `${cleanProxyUrl}/proxy/stream?d=${encodedDest}`;
                if (proxyPassword) {
                    proxyReqUrl += `&api_password=${encodeURIComponent(proxyPassword)}`;
                }

                // Also add User-Agent header via proxy params if supported?
                // MediaFlow supports 'h_user-agent' param to forward headers
                proxyReqUrl += `&h_user-agent=${encodeURIComponent(browserUserAgent)}`;

                console.log(`${logPrefix} 🛡️ Proxied URL: ${cleanProxyUrl}/proxy/stream?d=...`);
                url = proxyReqUrl;
            } catch (e) {
                console.error(`${logPrefix} ⚠️ Failed to construct proxy URL: ${e.message}`);
            }
        }

        try {
            const res = await axios.get(url, {
                timeout: 10000, // Increased timeout for proxy
                headers: { 'User-Agent': browserUserAgent }
            });

            console.log(`${logPrefix} Response status: ${res.status}`);
            const streamCount = res.data?.streams?.length || 0;
            console.log(`${logPrefix} Streams count: ${streamCount}`);

            if (streamCount === 0) {
                console.log(`${logPrefix} No valid streams in response`);
                console.log(`${logPrefix} Response data dump: ${JSON.stringify(res.data).substring(0, 500)}`);
            }

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
                    const name = (s.name || '').toLowerCase();
                    const title = (s.title || s.name || '').toLowerCase();
                    const url = s.url || s.externalUrl || '';
                    const infoHash = s.infoHash || s.infohash;

                    // Filter out rate limit messages
                    if (title.includes('rate limit') || title.includes('exceed')) {
                        console.log(`${logPrefix} ⛔ Filtered: rate limit message`);
                        return false;
                    }

                    // Filter out error streams (🚫 symbol in name)
                    if (name.includes('🚫') || name.includes('[no') || name.includes('error')) {
                        console.log(`${logPrefix} ⛔ Filtered: error stream indicator in name`);
                        return false;
                    }

                    // Must have either a valid URL or an infoHash
                    if (!url && !infoHash) {
                        console.log(`${logPrefix} ⛔ Filtered: no URL or infoHash`);
                        return false;
                    }

                    // If has URL, validate it's a real domain (not placeholder like comet.fast)
                    if (url && !infoHash) {
                        try {
                            const parsed = new URL(url);
                            // Check for known placeholder domains
                            if (parsed.hostname === 'comet.fast' ||
                                parsed.hostname === 'error' ||
                                !parsed.hostname.includes('.')) {
                                console.log(`${logPrefix} ⛔ Filtered: invalid/placeholder URL domain: ${parsed.hostname}`);
                                return false;
                            }

                            // Check for error/exception URLs (MediaFusion uses these)
                            if (parsed.pathname.includes('/exceptions/') ||
                                parsed.pathname.includes('/error/') ||
                                parsed.pathname.includes('invalid')) {
                                console.log(`${logPrefix} ⛔ Filtered: error/exception URL path: ${parsed.pathname}`);
                                return false;
                            }
                        } catch {
                            console.log(`${logPrefix} ⛔ Filtered: malformed URL: ${url}`);
                            return false;
                        }
                    }

                    // Filter out streams with error descriptions
                    const desc = (s.description || '').toLowerCase();
                    if (desc.includes('invalid') || desc.includes('error') || desc.includes('configuration')) {
                        console.log(`${logPrefix} ⛔ Filtered: error description detected`);
                        return false;
                    }

                    return true;
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

async function getAllStreams(provider, debridKey, type, id, customUrl = null, proxyUrl = null, proxyPassword = null) {
    const logPrefix = `[ScraperResolver]`;
    console.log(`${logPrefix} ========== GET ALL STREAMS ==========`);
    console.log(`${logPrefix} Provider: ${provider}, Type: ${type}, ID: ${id}`);
    if (proxyUrl) console.log(`${logPrefix} 🛡️ Proxy Enabled: ${proxyUrl}`);

    const scrapers = [];

    // 1. Custom scraper (AIOstreams)
    if (customUrl) {
        let baseUrl = customUrl.trim();
        if (baseUrl.startsWith('stremio://')) baseUrl = baseUrl.replace('stremio://', 'https://');
        if (baseUrl.startsWith('http://') && (baseUrl.includes('torrentio') || baseUrl.includes('comet') || baseUrl.includes('mediafusion') || baseUrl.includes('aiostreams'))) {
            baseUrl = baseUrl.replace('http://', 'https://');
        }
        baseUrl = baseUrl.replace(/\/$/, '');
        if (baseUrl.endsWith('/manifest.json')) baseUrl = baseUrl.replace('/manifest.json', '');

        const customBuilder = () => `${baseUrl}/stream/${type}/${id}.json`;
        scrapers.push({ name: 'custom', builder: customBuilder });
    }

    // 2. Fallback scrapers
    scrapers.push(
        { name: 'torrentio', builder: buildTorrentioUrl },
        { name: 'comet', builder: buildCometUrl },
        { name: 'mediafusion', builder: buildMediaFusionUrl }
    );

    const browserUserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

    for (const scraper of scrapers) {
        let url = scraper.builder(provider, debridKey, type, id);
        console.log(`${logPrefix} ---- Trying ${scraper.name} ----`);

        if (proxyUrl) {
            const cleanProxyUrl = proxyUrl.replace(/\/$/, '');
            const encodedDest = encodeURIComponent(url);
            let proxyReqUrl = `${cleanProxyUrl}/proxy/stream?d=${encodedDest}`;
            if (proxyPassword) proxyReqUrl += `&api_password=${encodeURIComponent(proxyPassword)}`;
            proxyReqUrl += `&h_user-agent=${encodeURIComponent(browserUserAgent)}`;
            url = proxyReqUrl;
        }

        try {
            const res = await axios.get(url, {
                timeout: 10000,
                headers: { 'User-Agent': browserUserAgent }
            });

            if (res.status === 200 && res.data.streams && res.data.streams.length > 0) {
                console.log(`${logPrefix} ✅ Found ${res.data.streams.length} streams from ${scraper.name}`);

                // Filter out error streams
                const validStreams = res.data.streams.filter(s => {
                    const name = (s.name || '').toLowerCase();
                    const title = (s.title || s.name || '').toLowerCase();
                    return !(title.includes('rate limit') || title.includes('exceed') || name.includes('🚫') || name.includes('[no') || name.includes('error'));
                });

                console.log(`${logPrefix} ✅ Returning ${validStreams.length} valid streams`);
                console.log(`${logPrefix} ========== END GET ALL STREAMS ==========`);
                return validStreams;
            }
        } catch (e) {
            console.error(`${logPrefix} ❌ ${scraper.name} failed: ${e.message}`);
        }
    }

    console.log(`${logPrefix} ❌ All scrapers failed`);
    console.log(`${logPrefix} ========== END GET ALL STREAMS ==========`);
    return [];
}

module.exports = { resolveBestStream, getAllStreams };

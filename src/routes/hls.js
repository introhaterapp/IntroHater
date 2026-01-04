/**
 * HLS Routes
 * Handles HLS proxy, voting, and subtitle endpoints
 */

const express = require('express');
const router = express.Router();
const axios = require('axios');

const { getByteOffset, getStreamDetails, getRefinedOffsets, getChapters, generateFragmentedManifest, generateSmartManifest, processExternalPlaylist } = require('../services/hls-proxy');
const skipService = require('../services/skip-service');
const userService = require('../services/user-service');
const cacheService = require('../services/cache-service');
const debridResolver = require('../services/debrid-resolver');

// ==================== Helpers ====================

// Helper: Format Seconds to VTT Time (HH:MM:SS.mmm)
function toVTTTime(seconds) {
    const date = new Date(0);
    date.setMilliseconds(seconds * 1000);
    return date.toISOString().substr(11, 12);
}

// SSRF Protection: Block internal/private IP ranges
function isSafeUrl(urlStr) {
    try {
        const url = new URL(urlStr);
        const host = url.hostname.toLowerCase();

        if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '::1') return false;

        if (host.startsWith('10.') ||
            host.startsWith('192.168.') ||
            host.match(/^172\.(1[6-9]|2[0-9]|3[0-1])\./)) return false;

        if (host === '169.254.169.254') return false;

        return ['http:', 'https:'].includes(url.protocol);
    } catch {
        return false;
    }
}

/*
 * PLATFORM COMPATIBILITY NOTES
 * ============================
 * Our HLS manifests use byte-range requests on MKV files. This works on Desktop/iOS
 * but FAILS on Android/Web because ExoPlayer/HLS.js cannot decode MKV containers.
 * 
 * SOLUTION: For Android + TorBox, we use TorBox's native HLS transcode API.
 * If that fails, we MUST redirect to the original stream (no intro skip) to prevent crashes.
 * 
 * Affected platforms (need transcoded HLS or direct redirect):
 * - Web Stremio (web.stremio.com, app.strem.io)
 * - Android (Galaxy, etc)
 * - Android TV / Google TV / Nvidia Shield
 * 
 * Working platforms (byte-range HLS works):
 * - Desktop Stremio (Windows, Mac, Linux)
 * - iOS Stremio
 */

// Helper: Detect Android-based clients that cannot handle byte-range MKV
function isAndroidClient(client, userAgent) {
    if (client === 'android' || client === 'google-tv') return true;
    const ua = (userAgent || '').toLowerCase();
    return ua.includes('android') || ua.includes('exoplayer') || ua.includes('shield');
}

// ==================== Routes ====================

// VTT Subtitle Status
router.get('/sub/status/:videoId.vtt', async (req, res) => {
    const vid = req.params.videoId;
    const segments = await skipService.getSegments(vid) || [];

    let vtt = "WEBVTT\n\n";

    if (segments.length === 0) {
        vtt += `00:00:00.000 --> 00:00:05.000\nNo skip segments found.\n\n`;
    } else {
        segments.forEach(seg => {
            const start = toVTTTime(seg.start);
            const end = toVTTTime(seg.end);
            const label = seg.category || 'Intro';
            vtt += `${start} --> ${end}\n[${label}] ⏭️ Skipping...\n\n`;
        });
    }

    res.set('Content-Type', 'text/vtt');
    res.send(vtt);
});

router.get('/play', async (req, res) => {
    const streamUrl = req.query.url;
    const keyPrefix = req.query.key?.substring(0, 8) || 'PLAY';
    const logPrefix = `[Play ${keyPrefix}]`;

    if (!streamUrl) {
        return res.status(400).send('Missing url parameter');
    }

    console.log(`${logPrefix} 📍 Resolving: ${streamUrl.substring(0, 60)}...`);

    // Skip resolution for proxy streaming URLs - they ARE the stream, not a redirect
    // Comet /playback/, StremThru, and MediaFusion all proxy streams through their servers
    const isProxyStream = streamUrl.includes('/playback/') ||
        streamUrl.toLowerCase().includes('stremthru') ||
        streamUrl.toLowerCase().includes('mediafusion');

    if (isProxyStream) {
        console.log(`${logPrefix} 🔄 Proxy stream detected - direct pass-through`);
        res.set('Access-Control-Allow-Origin', '*');
        return res.redirect(302, streamUrl);
    }

    try {
        const resolveRes = await axios.get(streamUrl, {
            maxRedirects: 5,
            timeout: 15000,
            headers: { 'User-Agent': 'Stremio/4.4', 'Range': 'bytes=0-0' },
            responseType: 'stream'
        });

        const finalUrl = resolveRes.request.res.responseUrl || resolveRes.config.url;
        resolveRes.data.destroy();

        console.log(`${logPrefix} ✅ Resolved to: ${finalUrl.substring(0, 60)}...`);
        res.set('Access-Control-Allow-Origin', '*');
        return res.redirect(302, finalUrl);
    } catch (e) {
        console.log(`${logPrefix} ❌ Resolution failed: ${e.message}`);
        res.set('Access-Control-Allow-Origin', '*');
        return res.redirect(302, streamUrl);
    }
});

// HLS Media Playlist Endpoint
router.get(['/hls/manifest.m3u8', '/:config/hls/manifest.m3u8'], async (req, res) => {
    // Parse from query params (primary method)
    const { stream, infoHash, start: startStr, end: endStr, id: videoId, user: userId, client, s, h, transcode } = req.query;
    const provider = req.query.provider || 'realdebrid';
    const rdKey = req.query.rdKey;

    // Get custom scraper from hash (h=HASH) or legacy base64 (s=BASE64)
    let customScraper = null;
    if (h) {
        customScraper = cacheService.getScraperConfig(h);
        if (!customScraper) {
            console.log(`[HLS] ⚠️ Scraper config not found for hash: ${h}`);
        }
    } else if (s) {
        customScraper = Buffer.from(s, 'base64').toString('utf8');
    }

    const keyPrefix = rdKey ? rdKey.substring(0, 8) : 'NO-KEY';
    const logPrefix = `[HLS ${keyPrefix}]`;


    // Express already decodes query params, but let's verify exact state
    let streamUrl = stream || null;
    console.log(`${logPrefix} Raw stream param: ${stream}`);
    console.log(`${logPrefix} Processed streamUrl: ${streamUrl}`);

    // Stream URL should now be embedded from browse time
    // No more server-side scraper calls at play time!


    if (infoHash && !streamUrl) {
        console.log(`${logPrefix} 🔍 Resolving infoHash: ${infoHash} (Transcode: ${transcode})`);
        streamUrl = await debridResolver.resolveInfoHash(provider || 'realdebrid', rdKey, infoHash, { transcode: transcode === 'true', videoId: videoId });
        if (!streamUrl) {
            // Check for fallback URL (original Comet/Debrid stream)
            const fallbackUrl = req.query.fallback;
            if (fallbackUrl) {
                console.log(`${logPrefix} ⚠️ TorBox transcode unavailable, using fallback URL`);
                streamUrl = fallbackUrl;

                // CRITICAL: Android/Web clients CANNOT play our byte-range MKV manifests
                // They will crash. We MUST redirect directly to the stream.
                const isAndroid = isAndroidClient(client, req.get('User-Agent'));
                if (client === 'web' || isAndroid) {
                    console.log(`${logPrefix} 🛡️ ${isAndroid ? 'Android' : 'Web'} client + fallback = Direct redirect (HLS would crash)`);
                    res.set('Access-Control-Allow-Origin', '*');
                    return res.redirect(302, streamUrl);
                }
                // Only Desktop/iOS can continue with HLS generation on the fallback URL
            } else {
                console.error(`${logPrefix} ❌ Failed to resolve infoHash, no fallback available`);
                return res.status(502).send("Failed to resolve infoHash via debrid");
            }
        }
    }

    // EARLY EXIT: Check if the resolved URL is already an HLS playlist (e.g. TorBox Transcode)
    // We check this BEFORE anything else to avoid probing/safety checks on m3u8 URLs which might fail
    if (streamUrl && streamUrl.includes('.m3u8')) {
        console.log(`${logPrefix} ↪️ Resolved URL is m3u8, patching for skip support...`);

        const skipStart = (startStr && !isNaN(parseFloat(startStr))) ? parseFloat(startStr) : null;
        const skipEnd = (endStr && !isNaN(parseFloat(endStr))) ? parseFloat(endStr) : null;

        try {
            const patchedM3u8 = await processExternalPlaylist(streamUrl, skipStart, skipEnd);
            res.set('Content-Type', 'application/vnd.apple.mpegurl');
            res.set('Access-Control-Allow-Origin', '*');
            return res.send(patchedM3u8);
        } catch (e) {
            console.error(`${logPrefix} ❌ Failed to patch external playlist, falling back to redirect: ${e.message}`);
            res.set('Access-Control-Allow-Origin', '*');
            return res.redirect(302, streamUrl);
        }
    }

    if (!streamUrl || !isSafeUrl(streamUrl)) {
        console.log(`${logPrefix} ❌ Invalid or unsafe stream URL`);
        return res.status(400).send("Invalid or unsafe stream URL");
    }

    // Client detection log
    console.log(`${logPrefix} 📥 Manifest request for ${videoId || 'unknown'}`);
    console.log(`${logPrefix} 📱 Client detected: ${client || 'unknown'} (User-Agent: ${req.get('User-Agent') || 'none'})`);

    // Authenticated Telemetry
    if (videoId && userId && rdKey) {
        if (!cacheService.isWatchLogged(userId, videoId)) {
            try {
                // Use provider-specific auth endpoint
                const authUrl = provider === 'torbox'
                    ? 'https://api.torbox.app/v1/api/user/me'
                    : provider === 'premiumize'
                        ? 'https://www.premiumize.me/api/account/info'
                        : provider === 'alldebrid'
                            ? 'https://api.alldebrid.com/v4/user'
                            : 'https://api.real-debrid.com/rest/1.0/user';

                const authHeader = provider === 'torbox'
                    ? { 'Authorization': `Bearer ${rdKey}` }
                    : provider === 'alldebrid'
                        ? { 'Authorization': `Bearer ${rdKey}` }
                        : { 'Authorization': `Bearer ${rdKey}` };

                await axios.get(authUrl, {
                    headers: authHeader,
                    timeout: 2000
                });

                cacheService.logWatch(userId, videoId);
                console.log(`${logPrefix} 📊 Play logged for ${videoId}`);

                userService.addWatchHistory(userId, {
                    videoId: videoId,
                    skip: { start: parseFloat(startStr), end: parseFloat(endStr) }
                });

                userService.updateUserStats(userId, {
                    votes: 1,
                    videoId: videoId
                });
            } catch (e) {
                console.warn(`${logPrefix} ⚠️ Auth failed: ${e.message}`);
            }
        }
    }

    try {
        const introStart = parseFloat(startStr) || 0;
        const introEnd = parseFloat(endStr) || 0;

        // HLS Skip Mode
        // When false: Generates HLS manifest that skips intro sections
        // When true: Direct redirect (no skipping)
        const bypassHls = false;

        if (bypassHls) {
            console.log(`${logPrefix} 🔀 BYPASS MODE: Resolving redirects on stream URL`);
            console.log(`${logPrefix} 📍 Original URL: ${streamUrl.substring(0, 80)}...`);

            try {
                // Follow redirects to get the actual CDN URL (Comet playback URLs redirect to RD)
                // Use GET with maxRedirects to follow the chain (HEAD returns 405 from Comet)
                const resolveRes = await axios.get(streamUrl, {
                    maxRedirects: 5, // Follow redirects
                    timeout: 15000,
                    headers: { 'User-Agent': 'Stremio/4.4', 'Range': 'bytes=0-0' }, // Range to minimize data
                    responseType: 'stream' // Stream to avoid downloading the whole file
                });

                // Get the final URL after redirects
                const finalUrl = resolveRes.request.res.responseUrl || resolveRes.config.url;
                if (finalUrl && finalUrl !== streamUrl) {
                    streamUrl = finalUrl;
                    console.log(`${logPrefix} 🔀 Resolved to: ${streamUrl.substring(0, 80)}...`);
                }

                // Close the stream immediately
                resolveRes.data.destroy();
            } catch (e) {
                console.log(`${logPrefix} ⚠️ Could not resolve redirects: ${e.message}`);
            }

            console.log(`${logPrefix} 📍 Final URL: ${streamUrl.substring(0, 80)}...`);
            res.set('Access-Control-Allow-Origin', '*');
            res.set('Access-Control-Expose-Headers', 'Location');
            return res.redirect(302, streamUrl);
        }



        // Fallback for Web/Android + MKV (ExoPlayer/HLS.js doesn't support byte-range MKV)
        const isMKV = streamUrl.toLowerCase().includes('.mkv') || streamUrl.toLowerCase().includes('matroska');
        const isAndroid = isAndroidClient(client, req.get('User-Agent'));
        if ((client === 'web' || isAndroid) && isMKV) {
            console.log(`${logPrefix} 🛡️ ${isAndroid ? 'Android' : 'Web'} + MKV detected - direct redirect (HLS would crash)`);
            res.set('Access-Control-Allow-Origin', '*');
            return res.redirect(302, streamUrl);
        }

        // Cache Key
        const cacheKey = `${streamUrl}_${introStart}_${introEnd}_${client || 'desktop'}`;
        if (cacheService.hasManifest(cacheKey)) {
            console.log(`${logPrefix} 💾 Cache hit`);
            res.set('Content-Type', 'application/vnd.apple.mpegurl');
            return res.send(cacheService.getManifest(cacheKey));
        }

        console.log(`${logPrefix} 🎬 Generating manifest (skip: ${introStart}s - ${introEnd}s)`);

        // Resolve Redirects & Get Length
        const details = await getStreamDetails(streamUrl);
        if (details.finalUrl !== streamUrl) {
            console.log(`${logPrefix} 🔀 Redirect resolved`);
            streamUrl = details.finalUrl;
        }
        const totalLength = details.contentLength;
        const duration = details.duration;
        console.log(`${logPrefix} 📏 Content-Length: ${totalLength ? (totalLength / 1024 / 1024).toFixed(0) + 'MB' : 'Unknown'}`);
        console.log(`${logPrefix} ⏱️ Duration: ${duration ? duration.toFixed(0) + 's' : 'Unknown'}`);

        // Check for Invalid/Error Streams
        const URL_LOWER = streamUrl.toLowerCase();
        if (URL_LOWER.includes('failed_opening')) {
            console.warn(`${logPrefix} ⚠️ Error stream detected, bypassing proxy`);
            return res.redirect(streamUrl);
        }

        // Final check for MKV on Web/Android after redirection resolution
        const isStillMKV = streamUrl.toLowerCase().includes('.mkv') || streamUrl.toLowerCase().includes('matroska');
        if ((client === 'web' || isAndroid) && isStillMKV) {
            console.log(`${logPrefix} 🛡️ Final URL is MKV on ${isAndroid ? 'Android' : 'Web'} - direct redirect`);
            res.set('Access-Control-Allow-Origin', '*');
            return res.redirect(302, streamUrl);
        }

        let manifest = "";
        let isSuccess = false;

        // Optimized strategy for Android/Google TV: Use Spliced (Smart) Manifest
        // Desktop is generally robust enough for fragmented
        const useSmartManifest = client === 'android' || client === 'google-tv';

        // Try Chapter Discovery if no skip segments provided
        if ((!introStart || introStart === 0) && (!introEnd || introEnd === 0)) {
            console.log(`${logPrefix} 🔍 No skip segments, checking chapters...`);
            const chapters = await getChapters(streamUrl);
            const skipChapter = chapters.find(c => {
                const t = c.title.toLowerCase();
                return t.includes('intro') || t.includes('opening') || t === 'op';
            });

            if (skipChapter) {
                console.log(`${logPrefix} 📖 Found chapter: "${skipChapter.title}" (${skipChapter.startTime}s - ${skipChapter.endTime}s)`);

                const cStart = skipChapter.startTime;
                const cEnd = skipChapter.endTime;

                if (videoId && userId) {
                    console.log(`${logPrefix} 💾 Backfilling chapter data`);
                    skipService.addSkipSegment(videoId, cStart, cEnd, "Intro", "chapter-bot")
                        .catch(e => console.error(`${logPrefix} ❌ Backfill failed: ${e.message}`));
                }

                if (useSmartManifest) {
                    const offset = await getByteOffset(streamUrl, cEnd);
                    if (offset > 0) {
                        manifest = generateSmartManifest(streamUrl, duration, offset, totalLength);
                        isSuccess = true;
                    }
                } else {
                    const points = await getRefinedOffsets(streamUrl, cStart, cEnd);
                    if (points) {
                        manifest = generateFragmentedManifest(streamUrl, duration, totalLength, {
                            startTime: cStart,
                            endTime: cEnd,
                            startOffset: points.startOffset,
                            endOffset: points.endOffset
                        });
                        isSuccess = true;
                    }
                }
            }
        }

        // Get Offsets if we have start and end times
        if (!isSuccess && introStart > 0 && introEnd > introStart) {
            if (useSmartManifest) {
                const offset = await getByteOffset(streamUrl, introEnd);
                if (offset > 0) {
                    console.log(`${logPrefix} ✂️ Splicing at byte ${offset}`);
                    manifest = generateSmartManifest(streamUrl, duration, offset, totalLength);
                    isSuccess = true;
                }
            } else {
                const points = await getRefinedOffsets(streamUrl, introStart, introEnd);
                if (points) {
                    console.log(`${logPrefix} ✂️ Splicing at bytes ${points.startOffset} - ${points.endOffset}`);
                    manifest = generateFragmentedManifest(streamUrl, duration, totalLength, {
                        startTime: introStart,
                        endTime: introEnd,
                        startOffset: points.startOffset,
                        endOffset: points.endOffset
                    });
                    isSuccess = true;
                }
            }
        }

        // Fallback or Simple Skip
        if (!manifest) {
            const startTime = introEnd || introStart;
            if (startTime > 0) {
                const offset = await getByteOffset(streamUrl, startTime);

                if (offset > 0) {
                    if (useSmartManifest) {
                        manifest = generateSmartManifest(streamUrl, duration, offset, totalLength);
                    } else {
                        manifest = generateFragmentedManifest(streamUrl, duration, totalLength, {
                            startTime: 0,
                            endTime: startTime,
                            startOffset: 0,
                            endOffset: offset
                        });
                    }
                    isSuccess = true;
                } else {
                    console.warn(`${logPrefix} ⚠️ Failed to find offset for ${startTime}s`);
                }
            }
        }

        // Pass-through if all failed
        if (!manifest || !isSuccess) {
            const reason = !manifest ? "Manifest generation failed" : "Unknown error";
            console.log(`${logPrefix} ⚠️ ${reason}. Fallback mode...`);
            console.log(`${logPrefix} 🐛 Debug Info: IntroStart=${introStart}, IntroEnd=${introEnd}, Duration=${duration}, Length=${totalLength}`);

            // CRITICAL: Android/Web clients crash on byte-range MKV manifests
            // If we couldn't generate a proper manifest, redirect directly
            if (client === 'web' || isAndroid) {
                console.log(`${logPrefix} 🛡️ ${isAndroid ? 'Android' : 'Web'} client - redirecting to original stream (safer than fragmented manifest)`);
                res.set('Access-Control-Allow-Origin', '*');
                return res.redirect(302, streamUrl);
            }

            // Desktop/iOS can handle the fragmented manifest even if not perfect
            manifest = generateFragmentedManifest(streamUrl, duration, totalLength, null);
            isSuccess = true;
        }

        // Cache the manifest
        cacheService.setManifest(cacheKey, manifest);

        res.set('Content-Type', 'application/vnd.apple.mpegurl');
        res.send(manifest);

    } catch (e) {
        console.error(`${logPrefix} ❌ Proxy Error: ${e.message}`);
        console.log(`${logPrefix} 🔄 Fallback: Redirecting to original stream`);
        res.redirect(req.query.stream);
    }
});

// Voting Redirects
router.get('/vote/:action/:videoId', (req, res) => {
    const { action, videoId } = req.params;
    const { stream, start, end, user } = req.query;
    const protocol = req.protocol;
    const host = req.get('host');
    const baseUrl = `${protocol}://${host}`;

    const userId = user || 'anonymous';
    console.log(`[Vote] 🗳️ User ${userId.substr(0, 6)} voted ${action.toUpperCase()} on ${videoId}`);

    userService.updateUserStats(userId, {
        votes: 1,
        videoId: videoId
    });

    if (action === 'down') {
        const originalUrl = decodeURIComponent(stream);
        console.log(`[Vote] ⬇️ Redirecting to original stream`);
        res.redirect(originalUrl);
    } else {
        const proxyUrl = `${baseUrl}/hls/manifest.m3u8?stream=${stream}&start=${start}&end=${end}`;
        console.log(`[Vote] ⬆️ Redirecting to skip stream`);
        res.redirect(proxyUrl);
    }
});

module.exports = router;

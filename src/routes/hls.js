/**
 * HLS Routes
 * Handles HLS proxy, voting, and subtitle endpoints
 */

const express = require('express');
const router = express.Router();
const axios = require('axios');

const { getByteOffset, getStreamDetails, getRefinedOffsets, getChapters, generateFragmentedManifest, generateSmartManifest } = require('../services/hls-proxy');
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
 * WEB STREMIO LIMITATION
 * ======================
 * Web Stremio (browser-based) cannot play our HLS manifests. This is a fundamental
 * limitation that cannot be fixed without server-side transcoding.
 * 
 * Root cause: Our manifests use byte-range requests on MKV files. Web Stremio's
 * streaming server (Lavf/FFmpeg) fetches these, but the browser's HLS.js player
 * cannot decode MKV containers - it only supports MPEG-TS and fMP4 segments.
 * 
 * Attempted fixes that did NOT work:
 * - 302 redirect to original stream URL
 * - Pass-through manifest without byte-ranges
 * - Removing EXT-X-DISCONTINUITY tags
 * - Increasing header size
 * 
 * The only real fix would be server-side remuxing (MKV → MPEG-TS), which would
 * require significant CPU/bandwidth resources and is not viable for this project.
 * 
 * Affected platforms:
 * - Web Stremio (web.stremio.com, app.strem.io) - User-Agent: Lavf/, node-fetch
 * - Google TV 
 * - Android TV
 * 
 * Working platforms:
 * - Desktop Stremio
 * - iOS Stremio
 */

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

// HLS Media Playlist Endpoint
router.get('/hls/manifest.m3u8', async (req, res) => {
    const { stream, infoHash, start: startStr, end: endStr, id: videoId, user: userId, rdKey, client, provider, quality, s } = req.query;
    const keyPrefix = rdKey ? rdKey.substring(0, 8) : 'NO-KEY';
    const logPrefix = `[HLS ${keyPrefix}]`;

    let streamUrl = stream ? decodeURIComponent(stream) : null;

    // Deferred Stream Resolution
    if (!streamUrl && !infoHash && quality) {
        const scraperResolver = require('../services/scraper-resolver');
        const customScraper = s ? Buffer.from(s, 'base64').toString('utf8') : null;
        console.log(`${logPrefix} 🔎 Deferred resolution triggered (Priority: ${quality})`);
        if (customScraper) console.log(`${logPrefix} 🌐 Using custom scraper URL`);

        streamUrl = await scraperResolver.resolveBestStream(
            provider || 'realdebrid',
            rdKey,
            videoId.includes(':') ? 'series' : 'movie',
            videoId,
            quality,
            customScraper
        );
    }


    if (infoHash && !streamUrl) {
        console.log(`${logPrefix} 🔍 Resolving infoHash: ${infoHash}`);
        streamUrl = await debridResolver.resolveInfoHash(provider || 'realdebrid', rdKey, infoHash);
        if (!streamUrl) {
            console.error(`${logPrefix} ❌ Failed to resolve infoHash`);
            return res.status(502).send("Failed to resolve infoHash via debrid");
        }
    }

    if (!streamUrl || !isSafeUrl(streamUrl)) {
        console.log(`${logPrefix} ❌ Invalid or unsafe stream URL`);
        return res.status(400).send("Invalid or unsafe stream URL");
    }

    console.log(`${logPrefix} 📥 Manifest request for ${videoId || 'unknown'} (Client: ${client || 'unknown'})`);

    // Authenticated Telemetry
    if (videoId && userId && rdKey) {
        if (!cacheService.isWatchLogged(userId, videoId)) {
            try {
                await axios.get('https://api.real-debrid.com/rest/1.0/user', {
                    headers: { 'Authorization': `Bearer ${rdKey}` },
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

        // Fallback for Web Stremio + MKV (HLS.js doesn't support MKV)
        const isMKV = streamUrl.toLowerCase().includes('.mkv') || streamUrl.toLowerCase().includes('matroska');
        if (client === 'web' && isMKV) {
            console.log(`${logPrefix} ⚠️ Web Client + MKV detected, bypassing proxy for compatibility`);
            return res.redirect(streamUrl);
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

        // Final check for MKV on Web after redirection resolution
        const isStillMKV = streamUrl.toLowerCase().includes('.mkv') || streamUrl.toLowerCase().includes('matroska');
        if (client === 'web' && isStillMKV) {
            console.log(`${logPrefix} ⚠️ Final URL is MKV, bypassing proxy for compatibility`);
            return res.redirect(streamUrl);
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
            console.log(`${logPrefix} ➡️ No valid skip points, generating pass-through`);
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

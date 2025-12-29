/**
 * HLS Routes
 * Handles HLS proxy, voting, and subtitle endpoints
 */

const express = require('express');
const router = express.Router();
const axios = require('axios');

const { getByteOffset, generateSmartManifest, getStreamDetails, getRefinedOffsets, generateSpliceManifest, getChapters } = require('../services/hls-proxy');
const skipService = require('../services/skip-service');
const userService = require('../services/user-service');
const cacheService = require('../services/cache-service');

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

function isWebStremioClient(req) {
    const ua = req.get('User-Agent') || '';

    // Web Stremio uses these User-Agents (streaming server proxies the request)
    // These should be REDIRECTED to original stream (can't handle MKV byte-ranges)
    const webStremioIndicators = [
        'Lavf/',              // FFmpeg/libavformat - Web Stremio streaming server
        'node-fetch'          // Node.js fetch - Web Stremio streaming server
    ];

    const isWebStremio = webStremioIndicators.some(indicator => ua.includes(indicator));

    // Native app indicators (should get HLS manifest with skip)
    const nativeIndicators = [
        'Electron',           // Desktop Stremio
        'ExoPlayer',          // Android native player
        'AppleCoreMedia',     // iOS/tvOS native
        'KSPlayer',           // iOS Stremio player
        'libmpv',             // MPV player (Desktop Stremio)
        'VLC',                // VLC player
        'okhttp',             // Android HTTP client
        'Dalvik',             // Android runtime (Android TV, phones)
        'stagefright',        // Android media framework
        'MediaPlayer',        // Generic media player
        'Kodi',               // Kodi media center
        'GStreamer'           // GStreamer framework
    ];

    const isNativeApp = nativeIndicators.some(indicator => ua.includes(indicator));

    // Redirect Web Stremio, let native apps get manifest
    return isWebStremio && !isNativeApp;
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

// HLS Media Playlist Endpoint
router.get('/hls/manifest.m3u8', async (req, res) => {
    const { stream, start: startStr, end: endStr, id: videoId, user: userId, rdKey } = req.query;
    const keyPrefix = rdKey ? rdKey.substring(0, 8) : 'NO-KEY';
    const logPrefix = `[HLS ${keyPrefix}]`;

    if (!stream || !isSafeUrl(decodeURIComponent(stream))) {
        console.log(`${logPrefix} ❌ Invalid or unsafe stream URL`);
        return res.status(400).send("Invalid or unsafe stream URL");
    }

    console.log(`${logPrefix} 📥 Manifest request for ${videoId || 'unknown'}`);

    if (isWebStremioClient(req)) {
        const originalUrl = decodeURIComponent(stream);
        console.log(`${logPrefix} 🌐 Web Stremio detected - returning pass-through (no skip)`);

        // Return a simple pass-through manifest - just plays the whole file from start
        // No byte-range tricks, no discontinuity - just a basic VOD manifest
        const passThrough = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:7200
#EXT-X-PLAYLIST-TYPE:VOD

#EXTINF:7200,
${originalUrl}

#EXT-X-ENDLIST`;

        res.set('Content-Type', 'application/vnd.apple.mpegurl');
        return res.send(passThrough);
    }

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
        let streamUrl = decodeURIComponent(stream);
        const introStart = parseFloat(startStr) || 0;
        const introEnd = parseFloat(endStr) || 0;

        // Cache Key
        const cacheKey = `${streamUrl}_${introStart}_${introEnd}`;
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
        console.log(`${logPrefix} 📏 Content-Length: ${totalLength ? (totalLength / 1024 / 1024).toFixed(0) + 'MB' : 'Unknown'}`);

        // Check for Invalid/Error Streams
        const URL_LOWER = streamUrl.toLowerCase();
        if (URL_LOWER.includes('failed_opening')) {
            console.warn(`${logPrefix} ⚠️ Error stream detected, bypassing proxy`);
            return res.redirect(streamUrl);
        }

        let manifest = "";
        let isSuccess = false;

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

                const points = await getRefinedOffsets(streamUrl, cStart, cEnd);
                if (points) {
                    manifest = generateSpliceManifest(streamUrl, 7200, points.startOffset, points.endOffset, totalLength);
                    isSuccess = true;
                }
            }
        }

        // Get Offsets if we have start and end times
        if (!isSuccess && introStart > 0 && introEnd > introStart) {
            const points = await getRefinedOffsets(streamUrl, introStart, introEnd);
            if (points) {
                console.log(`${logPrefix} ✂️ Splicing at bytes ${points.startOffset} - ${points.endOffset}`);
                manifest = generateSpliceManifest(streamUrl, 7200, points.startOffset, points.endOffset, totalLength);
                isSuccess = true;
            } else {
                console.warn(`${logPrefix} ⚠️ Failed to find splice points, falling back`);
            }
        }

        // Fallback or Simple Skip
        if (!manifest) {
            const startTime = introEnd || introStart;
            if (startTime > 0) {
                const offset = await getByteOffset(streamUrl, startTime);

                if (offset > 0) {
                    manifest = generateSmartManifest(streamUrl, 7200, offset, totalLength, startTime);
                    isSuccess = true;
                } else {
                    console.warn(`${logPrefix} ⚠️ Failed to find offset for ${startTime}s`);
                }
            }
        }

        // Pass-through if all failed
        if (!manifest || !isSuccess) {
            console.log(`${logPrefix} ➡️ No valid skip points, generating pass-through`);
            manifest = generateSmartManifest(streamUrl, 7200, 0, totalLength, 0);
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

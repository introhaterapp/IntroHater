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
const { generateUserId } = require('../middleware/rdAuth');

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
    } catch (e) {
        return false;
    }
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
    const { stream, start: startStr, end: endStr, id: videoId, user: userId } = req.query;

    if (!stream || !isSafeUrl(decodeURIComponent(stream))) {
        return res.status(400).send("Invalid or unsafe stream URL");
    }

    // Authenticated Telemetry
    const rdKey = req.query.rdKey;
    if (videoId && userId && rdKey) {
        if (!cacheService.isWatchLogged(userId, videoId)) {
            try {
                await axios.get('https://api.real-debrid.com/rest/1.0/user', {
                    headers: { 'Authorization': `Bearer ${rdKey}` },
                    timeout: 2000
                });

                cacheService.logWatch(userId, videoId);
                console.log(`[Telemetry] Play logged for ${userId.substr(0, 6)} on ${videoId}`);

                userService.addWatchHistory(userId, {
                    videoId: videoId,
                    skip: { start: parseFloat(startStr), end: parseFloat(endStr) }
                });

                userService.updateUserStats(userId, {
                    votes: 1,
                    videoId: videoId
                });
            } catch (e) {
                console.warn(`[Telemetry] Auth failed for ${userId.substr(0, 6)}: ${e.message}`);
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
            res.set('Content-Type', 'application/vnd.apple.mpegurl');
            return res.send(cacheService.getManifest(cacheKey));
        }

        console.log(`[HLS] Generating manifest for Intro: ${introStart}s - ${introEnd}s`);

        // Resolve Redirects & Get Length
        console.log(`[HLS] Probing URL: ${streamUrl}`);
        const details = await getStreamDetails(streamUrl);
        if (details.finalUrl !== streamUrl) {
            console.log(`[HLS] Resolved Redirect: ${details.finalUrl}`);
            streamUrl = details.finalUrl;
        }
        const totalLength = details.contentLength;
        console.log(`[HLS] Content-Length: ${totalLength || 'Unknown'}`);

        // Check for Invalid/Error Streams
        const URL_LOWER = streamUrl.toLowerCase();
        if (URL_LOWER.includes('failed_opening')) {
            console.warn(`[HLS] Detected error stream (URL: ...${streamUrl.slice(-20)}). Bypassing proxy.`);
            return res.redirect(streamUrl);
        }

        let manifest = "";
        let isSuccess = false;

        // Try Chapter Discovery if no skip segments provided
        if ((!introStart || introStart === 0) && (!introEnd || introEnd === 0)) {
            console.log(`[HLS] No skip segments for ${videoId}. Checking chapters...`);
            const chapters = await getChapters(streamUrl);
            const skipChapter = chapters.find(c => {
                const t = c.title.toLowerCase();
                return t.includes('intro') || t.includes('opening') || t === 'op';
            });

            if (skipChapter) {
                console.log(`[HLS] Found intro chapter: ${skipChapter.title} (${skipChapter.startTime}-${skipChapter.endTime}s)`);

                const cStart = skipChapter.startTime;
                const cEnd = skipChapter.endTime;

                if (videoId && userId) {
                    console.log(`[HLS] Backfilling chapter data for ${videoId} as 'chapter-bot'`);
                    skipService.addSkipSegment(videoId, cStart, cEnd, "Intro", "chapter-bot")
                        .catch(e => console.error(`[HLS] Backfill failed: ${e.message}`));
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
                console.log(`[HLS] Splicing at bytes: ${points.startOffset} -> ${points.endOffset}`);
                manifest = generateSpliceManifest(streamUrl, 7200, points.startOffset, points.endOffset, totalLength);
                isSuccess = true;
            } else {
                console.warn("[HLS] Failed to find splice points. Falling back to simple skip.");
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
                    console.warn(`[HLS] Failed to find offset for ${startTime}s. Returning non-skipping stream.`);
                }
            }
        }

        // Pass-through if all failed
        if (!manifest || !isSuccess) {
            console.log(`[HLS] No valid skip points found. Generating pass-through manifest for: ...${streamUrl.slice(-30)}`);
            manifest = generateSmartManifest(streamUrl, 7200, 0, totalLength, 0);
            isSuccess = true;
        }

        // Cache the manifest
        cacheService.setManifest(cacheKey, manifest);

        res.set('Content-Type', 'application/vnd.apple.mpegurl');
        res.send(manifest);

    } catch (e) {
        console.error("Proxy Error:", e.message);
        console.log("Fallback: Redirecting to original stream (Error-based redirect)");
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
    console.log(`[Vote] User ${userId.substr(0, 6)}... voted ${action.toUpperCase()} on ${videoId}`);

    userService.updateUserStats(userId, {
        votes: 1,
        videoId: videoId
    });

    if (action === 'down') {
        const originalUrl = decodeURIComponent(stream);
        console.log(`[Vote] Redirecting to original: ${originalUrl}`);
        res.redirect(originalUrl);
    } else {
        const proxyUrl = `${baseUrl}/hls/manifest.m3u8?stream=${stream}&start=${start}&end=${end}`;
        console.log(`[Vote] Redirecting to skip: ${proxyUrl}`);
        res.redirect(proxyUrl);
    }
});

module.exports = router;

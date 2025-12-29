

const express = require('express');
const router = express.Router();
const axios = require('axios');

const { getByteOffset, generateSmartManifest, getStreamDetails, getRefinedOffsets, generateSpliceManifest, getChapters } = require('../services/hls-proxy');
const skipService = require('../services/skip-service');
const userService = require('../services/user-service');
const cacheService = require('../services/cache-service');
const log = require('../utils/logger').hls;




function toVTTTime(seconds) {
    const date = new Date(0);
    date.setMilliseconds(seconds * 1000);
    return date.toISOString().substr(11, 12);
}


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


router.get('/hls/manifest.m3u8', async (req, res) => {
    const { stream, start: startStr, end: endStr, id: videoId, user: userId } = req.query;

    if (!stream || !isSafeUrl(decodeURIComponent(stream))) {
        return res.status(400).send("Invalid or unsafe stream URL");
    }


    const rdKey = req.query.rdKey;
    if (videoId && userId && rdKey) {
        if (!cacheService.isWatchLogged(userId, videoId)) {
            try {
                await axios.get('https://api.real-debrid.com/rest/1.0/user', {
                    headers: { 'Authorization': `Bearer ${rdKey}` },
                    timeout: 2000
                });

                cacheService.logWatch(userId, videoId);
                log.info({ userId: userId.substr(0, 6), videoId }, 'Play logged');

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


        const cacheKey = `${streamUrl}_${introStart}_${introEnd}`;
        if (cacheService.hasManifest(cacheKey)) {
            res.set('Content-Type', 'application/vnd.apple.mpegurl');
            return res.send(cacheService.getManifest(cacheKey));
        }

        log.info({ introStart, introEnd }, 'Generating manifest');


        log.info({ streamUrl }, 'Probing URL');
        const details = await getStreamDetails(streamUrl);
        if (details.finalUrl !== streamUrl) {
            log.info({ finalUrl: details.finalUrl }, 'Resolved Redirect');
            streamUrl = details.finalUrl;
        }
        const totalLength = details.contentLength;
        log.info({ contentLength: totalLength || 'Unknown' }, 'Content-Length');


        const URL_LOWER = streamUrl.toLowerCase();
        if (URL_LOWER.includes('failed_opening')) {
            console.warn(`[HLS] Detected error stream (URL: ...${streamUrl.slice(-20)}). Bypassing proxy.`);
            return res.redirect(streamUrl);
        }

        let manifest = "";
        let isSuccess = false;


        if ((!introStart || introStart === 0) && (!introEnd || introEnd === 0)) {
            log.info({ videoId }, 'No skip segments. Checking chapters.');
            const chapters = await getChapters(streamUrl);
            const skipChapter = chapters.find(c => {
                const t = c.title.toLowerCase();
                return t.includes('intro') || t.includes('opening') || t === 'op';
            });

            if (skipChapter) {
                log.info({ title: skipChapter.title, start: skipChapter.startTime, end: skipChapter.endTime }, 'Found intro chapter');

                const cStart = skipChapter.startTime;
                const cEnd = skipChapter.endTime;

                if (videoId && userId) {
                    log.info({ videoId }, "Backfilling chapter data as 'chapter-bot'");
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


        if (!isSuccess && introStart >= 0 && introEnd > introStart) {
            log.info({ introStart, introEnd }, 'Attempting splice manifest');
            const points = await getRefinedOffsets(streamUrl, introStart, introEnd);
            if (points && points.startOffset >= 0 && points.endOffset > points.startOffset) {
                log.info({ startOffset: points.startOffset, endOffset: points.endOffset, totalLength }, 'Splicing at bytes');
                manifest = generateSpliceManifest(streamUrl, 7200, points.startOffset, points.endOffset, totalLength);
                isSuccess = true;
            } else {
                // Probe failed - redirect immediately to avoid broken playback
                log.info({ introStart, introEnd, videoId }, 'Splice probe failed. Redirecting to original stream.');
                return res.redirect(req.query.stream);
            }
        }


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



        if (!manifest || !isSuccess) {
            log.info({ videoId, streamUrlShort: streamUrl.slice(-30) }, 'No skip points found. Redirecting to original stream.');
            return res.redirect(req.query.stream);
        }


        cacheService.setManifest(cacheKey, manifest);

        res.set('Content-Type', 'application/vnd.apple.mpegurl');
        res.send(manifest);

    } catch (e) {
        console.error("Proxy Error:", e.message);
        log.info("Fallback: Redirecting to original stream (Error-based redirect)");
        res.redirect(req.query.stream);
    }
});


router.get('/vote/:action/:videoId', (req, res) => {
    const { action, videoId } = req.params;
    const { stream, start, end, user } = req.query;
    const protocol = req.protocol;
    const host = req.get('host');
    const baseUrl = `${protocol}://${host}`;

    const userId = user || 'anonymous';
    log.info({ userId: userId.substr(0, 6), action: action.toUpperCase(), videoId }, 'User voted');

    userService.updateUserStats(userId, {
        votes: 1,
        videoId: videoId
    });

    if (action === 'down') {
        const originalUrl = decodeURIComponent(stream);
        log.info({ originalUrl }, 'Redirecting to original');
        res.redirect(originalUrl);
    } else {
        const proxyUrl = `${baseUrl}/hls/manifest.m3u8?stream=${stream}&start=${start}&end=${end}`;
        log.info({ proxyUrl }, 'Redirecting to skip');
        res.redirect(proxyUrl);
    }
});

module.exports = router;

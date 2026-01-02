const { spawn } = require('child_process');
const axios = require('axios'); // Requires axios
const { PROBE } = require('../config/constants');
const log = require('../utils/logger').hls;
let ffprobePath = 'ffprobe';

// We rely on 'ffprobe' being in the PATH (Docker/Linux or System install)
// Static binaries are handled by the caller (server.js) if necessary
// But default to 'ffprobe' string
try {
    if (process.platform === 'win32') {
        ffprobePath = require('ffprobe-static').path;
    }
} catch { /* ignore optional ffprobe-static */ }

const { getCachedProbe, setCachedProbe } = require('./cache-service');


// SSRF Protection (Duplicate of server logic for modularity)
function isSafeUrl(urlStr) {
    try {
        const url = new URL(urlStr);
        const host = url.hostname.toLowerCase();
        if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '::1') return false;
        if (host.startsWith('10.') || host.startsWith('192.168.') || host.match(/^172\.(1[6-9]|2[0-9]|3[0-1])\./)) return false;
        if (host === '169.254.169.254') return false;
        return ['http:', 'https:'].includes(url.protocol);
    } catch { return false; }
}

/**
 * Follows redirects to get the final direct URL and Contents-Length
 */
async function getStreamDetails(url) {
    if (!isSafeUrl(url)) return { finalUrl: url, contentLength: null, duration: null };

    // Check cache first
    const cacheKey = `details:${url}`;
    const cached = getCachedProbe(cacheKey);
    if (cached) return cached;

    try {
        const response = await axios.head(url, {
            maxRedirects: 10,
            validateStatus: (status) => status >= 200 && status < 400
        });

        const finalUrl = response.request.res ? response.request.res.responseUrl : url;
        const contentLength = response.headers['content-length'] ? parseInt(response.headers['content-length']) : null;

        // Try to get duration via ffprobe (needed for accurate fragmentation)
        let duration = null;
        try {
            const args = [
                '-v', 'error',
                '-show_entries', 'format=duration',
                '-of', 'default=noprint_wrappers=1:nokey=1',
                finalUrl
            ];
            const proc = spawn(ffprobePath, args);
            let stdout = '';
            proc.stdout.on('data', (d) => stdout += d);
            const exitCode = await new Promise(r => proc.on('close', r));
            if (exitCode === 0 && stdout.trim()) duration = parseFloat(stdout.trim());
        } catch (e) {
            log.warn({ err: e.message }, 'Failed to get duration via ffprobe');
        }

        const res = { finalUrl, contentLength, duration };
        setCachedProbe(cacheKey, res);
        return res;
    } catch (e) {
        log.warn({ err: e.message }, 'HEAD request failed. Using original URL.');
        return { finalUrl: url, contentLength: null, duration: null };
    }
}

/**
 * Probes a remote stream to find the byte offset for a given timestamp.
 * Uses 'read_intervals' which works on direct links.
 */
async function getByteOffset(url, startTime) {
    const cacheKey = `byte:${url}:${startTime}`;
    const cached = getCachedProbe(cacheKey);
    if (cached !== null) {
        log.info({ startTime }, 'Using cached byte offset');
        return cached;
    }

    return new Promise((resolve) => {
        // Arguments for ffprobe with read_intervals
        // We ensure we read significantly PAST the start time to find a keyframe
        // Increased to 60s to handle sparse keyframes
        // Optimized: Reduced interval to +10s
        const args = [
            '-read_intervals', `${startTime}%+10`,
            '-select_streams', 'v:0',
            '-show_entries', 'packet=pos,pts_time',
            '-show_packets',
            '-analyzeduration', '10000000',
            '-probesize', '10000000',
            '-v', 'error',
            '-of', 'json',
            url
        ];

        log.info({ startTime }, 'Spawning ffprobe');
        const proc = spawn(ffprobePath, args);

        const timeout = setTimeout(() => {
            log.warn({ startTime }, 'FFprobe timeout. Killing.');
            proc.kill('SIGKILL');
            resolve(0);
        }, PROBE.TIMEOUT_MS);

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data) => stdout += data);
        proc.stderr.on('data', (data) => stderr += data);

        proc.on('close', (code) => {
            clearTimeout(timeout);
            if (code !== 0) {
                log.warn({ code, stderr }, 'FFprobe exited with error');
                return resolve(0);
            }

            try {
                const data = JSON.parse(stdout);

                if (!data.packets || data.packets.length === 0) {
                    log.warn({ stderr }, 'No packets found (Packets array empty)');
                    return resolve(0);
                }

                // Check first packet
                const firstPkt = data.packets[0];
                const firstPts = parseFloat(firstPkt.pts_time);
                log.info({ firstPts, pos: firstPkt.pos }, 'First packet found');

                // If the first packet is WAY off (e.g. 0 when we asked for 90), seeking failed
                if (firstPts < (startTime - 20)) {
                    log.warn({ startTime, firstPts }, 'Seek failed? Requested time significantly different from first packet.');
                    // If we are somewhat close (e.g. 70s for 90s), we might accept it? 
                    // No, 20s drift is too much.
                    return resolve(0);
                }

                // Find the first packet >= startTime
                const packet = data.packets.find(p => parseFloat(p.pts_time) >= startTime);

                if (packet && packet.pos) {
                    log.info({ pos: packet.pos, pts: packet.pts_time }, 'Found precise offset');
                    const pos = parseInt(packet.pos);
                    setCachedProbe(cacheKey, pos);
                    resolve(pos);
                } else if (firstPkt.pos) {
                    // Fallback: If we couldn't find exact >= start, but we have *something* close (e.g. 88s for 90s)
                    // We take the closest one we have.
                    log.info({ firstPts }, 'Exact >= seek failed, using closest packet');
                    const pos = parseInt(firstPkt.pos);
                    setCachedProbe(cacheKey, pos);
                    resolve(pos);
                } else {
                    resolve(0);
                }
            } catch (e) {
                log.error({ err: e.message, stderr }, 'Parse error');
                resolve(0);
            }
        });
    });
}

/**
 * Generates an HLS playlist (m3u8) that plays a remote file starting from a specific byte offset.
 * @param {string} videoUrl - The original remote video URL.
 * @param {number} duration - Total duration of the video (optional, but good for EXTINF).
 * @param {number} byteOffset - The start byte offset.
 * @returns {string} - The m3u8 content.
 */
function generateSmartManifest(videoUrl, duration, byteOffset, totalLength) {
    const headerSize = 5000000;
    const len2 = totalLength ? (totalLength - byteOffset) : 99999999999;

    let m3u8 = `#EXTM3U
#EXT-X-VERSION:4
#EXT-X-TARGETDURATION:${Math.ceil(duration || 7200)}
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-PLAYLIST-TYPE:VOD
#EXT-X-ALLOW-CACHE:YES
#EXT-X-INDEPENDENT-SEGMENTS

#EXTINF:1,
#EXT-X-BYTERANGE:${headerSize}@0
${videoUrl}

#EXT-X-DISCONTINUITY
#EXTINF:${Math.ceil(duration || 7200)},
#EXT-X-BYTERANGE:${len2}@${byteOffset}
${videoUrl}

#EXT-X-ENDLIST`;

    return m3u8;
}

/**
 * Probes two timestamps (Intro Start & Intro End) in one go.
 * Returns precise byte offsets for both.
 */
async function getRefinedOffsets(url, startSec, endSec) {
    const cacheKey = `refined:${url}:${startSec}:${endSec}`;
    const cached = getCachedProbe(cacheKey);
    if (cached) {
        log.info({ startSec, endSec }, 'Using cached refined offsets');
        return cached;
    }

    return new Promise((resolve) => {
        // We probe both intervals in one command to save overhead
        // ffprobe read_intervals syntax: start%+duration,start2%+duration
        // Optimized: Reduced interval to +10s, added analyzeduration/probesize limits
        const interval = `${startSec}%+10,${endSec}%+10`;

        const args = [
            '-read_intervals', interval,
            '-select_streams', 'v:0',
            '-show_entries', 'packet=pos,pts_time',
            '-show_packets',
            '-analyzeduration', '10000000', // 10MB limit
            '-probesize', '10000000',       // 10MB limit
            '-v', 'error',
            '-of', 'json',
            url
        ];

        log.info({ startSec, endSec }, 'Probing splice points');
        const proc = spawn(ffprobePath, args);

        const timeout = setTimeout(() => {
            log.warn('FFprobe splice probe timeout. Killing.');
            proc.kill('SIGKILL');
            resolve(null);
        }, PROBE.SPLICE_TIMEOUT_MS);

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data) => stdout += data);
        proc.stderr.on('data', (data) => stderr += data);

        proc.on('close', (code) => {
            clearTimeout(timeout);
            if (code !== 0) {
                log.warn({ code }, 'Probe failed');
                return resolve(null);
            }

            try {
                const data = JSON.parse(stdout);
                if (!data.packets || data.packets.length === 0) return resolve(null);

                // Helper to find closest packet to target
                const findPacket = (target) => {
                    // Try to find one >= target
                    let p = data.packets.find(pkt => parseFloat(pkt.pts_time) >= target);
                    // Or ANY packet close to it?
                    if (!p) {
                        // Fallback to last packet if we are close?
                        // Filter packets around target
                        const candidates = data.packets.filter(pkt => Math.abs(parseFloat(pkt.pts_time) - target) < 10);
                        if (candidates.length > 0) p = candidates[0]; // Just take first close one
                    }
                    return p;
                };

                const startPkt = findPacket(startSec);
                const endPkt = findPacket(endSec);

                if (startPkt && endPkt) {
                    log.info({ startPts: startPkt.pts_time, startPos: startPkt.pos, endPts: endPkt.pts_time, endPos: endPkt.pos }, 'Splice points found');
                    const res = {
                        startOffset: parseInt(startPkt.pos),
                        endOffset: parseInt(endPkt.pos)
                    };
                    setCachedProbe(cacheKey, res);
                    return resolve(res);
                } else {
                    const lastPkt = data.packets[data.packets.length - 1];
                    const maxTime = lastPkt ? lastPkt.pts_time : "unknown";
                    log.warn({ startSec, endSec, maxTime }, 'Could not find packets for both points');
                    resolve(null);
                }
            } catch (e) {
                log.error({ err: e.message }, 'Parse error');
                resolve(null);
            }
        });
    });
}

/**
 * Extracts chapters from a remote video file using ffprobe.
 */
async function getChapters(url) {
    return new Promise((resolve) => {
        const args = [
            '-show_chapters',
            '-v', 'error',
            '-of', 'json',
            url
        ];

        log.info({ url }, 'Probing chapters');
        const proc = spawn(ffprobePath, args);

        const timeout = setTimeout(() => {
            log.warn('FFprobe chapter probe timeout. Killing.');
            proc.kill('SIGKILL');
            resolve([]);
        }, PROBE.CHAPTER_TIMEOUT_MS);

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data) => stdout += data);
        proc.stderr.on('data', (data) => stderr += data);

        proc.on('close', (code) => {
            clearTimeout(timeout);
            if (code !== 0) {
                log.warn({ code, stderr }, 'Chapter probe failed');
                return resolve([]);
            }

            try {
                const data = JSON.parse(stdout);
                if (!data.chapters || data.chapters.length === 0) return resolve([]);

                const chapters = data.chapters.map(c => ({
                    startTime: parseFloat(c.start_time),
                    endTime: parseFloat(c.end_time),
                    title: c.tags ? (c.tags.title || c.tags.TITLE || 'Chapter') : 'Chapter'
                }));

                log.info({ count: chapters.length }, 'Found chapters');
                resolve(chapters);
            } catch (e) {
                log.error({ err: e.message }, 'Chapter parse error');
                resolve([]);
            }
        });
    });
}

function generateSpliceManifest(videoUrl, duration, startOffset, endOffset, totalLength) {
    // Legacy single-segment splice manifest
    const len1 = startOffset;
    const len2 = totalLength ? (totalLength - endOffset) : 99999999999;

    return `#EXTM3U
#EXT-X-VERSION:4
#EXT-X-TARGETDURATION:7200
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-PLAYLIST-TYPE:VOD
#EXT-X-ALLOW-CACHE:YES
#EXT-X-INDEPENDENT-SEGMENTS

#EXTINF:100,
#EXT-X-BYTERANGE:${len1}@0
${videoUrl}

#EXTINF:7100,
#EXT-X-BYTERANGE:${len2}@${endOffset}
${videoUrl}

#EXT-X-ENDLIST`;
}

function generateFragmentedManifest(videoUrl, duration, totalLength, skipPoints = null) {
    const SEGMENT_DURATION = 10;
    const headerSize = 5000000;
    const realDuration = duration || 7200;
    const avgBitrate = totalLength ? (totalLength / realDuration) : (2500000 / 8); // Fallback to 2.5Mbps

    let m3u8 = `#EXTM3U
#EXT-X-VERSION:4
#EXT-X-TARGETDURATION:${SEGMENT_DURATION}
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-PLAYLIST-TYPE:VOD
#EXT-X-ALLOW-CACHE:YES
#EXT-X-INDEPENDENT-SEGMENTS

#EXTINF:1,
#EXT-X-BYTERANGE:${headerSize}@0
${videoUrl}
`;

    let currentTime = 0;
    let currentByte = headerSize;
    const skipStart = skipPoints ? skipPoints.startTime : -1;
    const skipEnd = skipPoints ? skipPoints.endTime : -1;
    const skipEndByte = skipPoints ? skipPoints.endOffset : -1;

    let segmentsAdded = 0;

    while (currentTime < realDuration) {
        // Handle Skip
        if (skipPoints && currentTime >= skipStart && currentTime < skipEnd) {
            // We are inside the skip zone. Jump to the end of the skip.
            currentTime = skipEnd;
            currentByte = skipEndByte !== -1 ? skipEndByte : (skipEnd * avgBitrate);
            m3u8 += `\n#EXT-X-DISCONTINUITY\n`;
            continue;
        }

        let segDur = Math.min(SEGMENT_DURATION, realDuration - currentTime);
        let segLen = Math.floor(segDur * avgBitrate);

        // Ensure we don't go past totalLength
        if (totalLength && (currentByte + segLen) > totalLength) {
            segLen = totalLength - currentByte;
        }

        if (segLen <= 0 && segmentsAdded > 0) break;

        m3u8 += `#EXTINF:${segDur.toFixed(3)},
#EXT-X-BYTERANGE:${segLen}@${currentByte}
${videoUrl}
`;

        currentTime += segDur;
        currentByte += segLen;
        segmentsAdded++;

        if (segmentsAdded > 2000) break; // Safety break
    }

    m3u8 += `#EXT-X-ENDLIST`;
    return m3u8;
}

/**
 * Proxies and patches an external HLS playlist to allow for intro skipping.
 * @param {string} playlistUrl - The external M3U8 URL.
 * @param {number|null} skipStart - Intro start time in seconds.
 * @param {number|null} skipEnd - Intro end time in seconds.
 * @returns {Promise<string>} - The patched M3U8 content.
 */
async function processExternalPlaylist(playlistUrl, skipStart = null, skipEnd = null) {
    try {
        const response = await axios.get(playlistUrl);
        const originalM3u8 = response.data;
        const lines = originalM3u8.split('\n');

        // Base URL for resolving relative segments
        // If playlistUrl is http://example.com/path/playlist.m3u8?token=123
        // Base is http://example.com/path/
        const urlObj = new URL(playlistUrl);
        const pathDir = urlObj.pathname.substring(0, urlObj.pathname.lastIndexOf('/') + 1);
        const baseUrl = `${urlObj.origin}${pathDir}`;
        const queryParams = urlObj.search; // ?token=123

        let patchedM3u8 = '';
        let currentTime = 0;
        let discontinuityPending = false;

        const isMaster = originalM3u8.includes('#EXT-X-STREAM-INF');

        for (let i = 0; i < lines.length; i++) {
            let line = lines[i].trim();
            if (!line) continue;

            // Pass through headers/metadata
            if (line.startsWith('#')) {
                if (line.startsWith('#EXTINF:')) {
                    // #EXTINF:10.000,
                    const durationStr = line.substring(8).split(',')[0];
                    const duration = parseFloat(durationStr);

                    // Skip Logic (Only for Media Playlists)
                    if (!isMaster && skipStart !== null && skipEnd !== null) {
                        const segmentStart = currentTime;
                        const segmentEnd = currentTime + duration;

                        // Check overlap with skip range
                        const isBefore = segmentEnd <= skipStart;
                        const isAfter = segmentStart >= skipEnd;

                        if (!isBefore && !isAfter) {
                            // Drop this segment
                            currentTime += duration;
                            discontinuityPending = true;
                            // Also skip the next line which is the URL
                            i++;
                            continue;
                        }
                    }

                    currentTime += duration;
                }

                patchedM3u8 += line + '\n';
            } else {
                // This is a URL line
                if (discontinuityPending) {
                    patchedM3u8 += '#EXT-X-DISCONTINUITY\n';
                    discontinuityPending = false;
                }

                let segmentUrl = line;
                // Rewrite to absolute if relative
                if (!segmentUrl.startsWith('http')) {
                    segmentUrl = baseUrl + segmentUrl;
                }

                // Append original query params (token) if not present
                if (queryParams) {
                    // Check if segment already has params
                    const separator = segmentUrl.includes('?') ? '&' : '?';
                    segmentUrl += separator + queryParams.substring(1);
                }

                patchedM3u8 += segmentUrl + '\n';
            }
        }

        return patchedM3u8;

    } catch (e) {
        log.error({ err: e.message, playlistUrl }, 'Failed to process external playlist');
        throw e;
    }
}

module.exports = {
    getStreamDetails,
    getByteOffset,
    generateSmartManifest,
    getRefinedOffsets,
    generateSpliceManifest,
    getChapters,
    generateFragmentedManifest,
    processExternalPlaylist
};

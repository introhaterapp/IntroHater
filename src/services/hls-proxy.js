const ffmpeg = require('fluent-ffmpeg');
const { Readable } = require('stream');
const { spawn } = require('child_process');
const path = require('path');
const axios = require('axios'); // Requires axios
let ffprobePath = 'ffprobe';

// We rely on 'ffprobe' being in the PATH (Docker/Linux or System install)
// Static binaries are handled by the caller (server_lite.js) if necessary
// But default to 'ffprobe' string
try {
    if (process.platform === 'win32') {
        ffprobePath = require('ffprobe-static').path;
    }
} catch (e) { }

// SSRF Protection (Duplicate of server_lite logic for modularity)
function isSafeUrl(urlStr) {
    try {
        const url = new URL(urlStr);
        const host = url.hostname.toLowerCase();
        if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '::1') return false;
        if (host.startsWith('10.') || host.startsWith('192.168.') || host.match(/^172\.(1[6-9]|2[0-9]|3[0-1])\./)) return false;
        if (host === '169.254.169.254') return false;
        return ['http:', 'https:'].includes(url.protocol);
    } catch (e) { return false; }
}

/**
 * Follows redirects to get the final direct URL and Contents-Length
 */
async function getStreamDetails(url) {
    if (!isSafeUrl(url)) return { finalUrl: url, contentLength: null };
    try {
        const response = await axios.head(url, {
            maxRedirects: 10,
            validateStatus: (status) => status >= 200 && status < 400
        });

        // If axios followed redirects, response.request.res.responseUrl is final
        // In newer axios, request.res.responseUrl might be available
        // But headers are what we care about.

        return {
            finalUrl: response.request.res ? response.request.res.responseUrl : url,
            contentLength: response.headers['content-length'] ? parseInt(response.headers['content-length']) : null
        };
    } catch (e) {
        console.warn(`[Helper] HEAD request failed: ${e.message}. Using original URL.`);
        return { finalUrl: url, contentLength: null };
    }
}

/**
 * Probes a remote stream to find the byte offset for a given timestamp.
 * Uses 'read_intervals' which works on direct links.
 */
async function getByteOffset(url, startTime) {
    return new Promise((resolve, reject) => {
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

        console.log(`[HLS Proxy] Spawning ffprobe for ${startTime}s...`);
        const proc = spawn(ffprobePath, args);

        const timeout = setTimeout(() => {
            console.warn(`[HLS Proxy] FFprobe timeout for ${startTime}s. Killing.`);
            proc.kill('SIGKILL');
            resolve(0);
        }, 15000); // 15s timeout

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data) => stdout += data);
        proc.stderr.on('data', (data) => stderr += data);

        proc.on('close', (code) => {
            clearTimeout(timeout);
            if (code !== 0) {
                console.warn(`[HLS Proxy] FFprobe exited with code ${code}. Stderr: ${stderr}`);
                return resolve(0);
            }

            try {
                const data = JSON.parse(stdout);

                if (!data.packets || data.packets.length === 0) {
                    console.warn(`[HLS Proxy] No packets found (Packets array empty). Stderr: ${stderr}`);
                    return resolve(0);
                }

                // Check first packet
                const firstPkt = data.packets[0];
                const firstPts = parseFloat(firstPkt.pts_time);
                console.log(`[HLS Proxy] First packet at ${firstPts}s (pos: ${firstPkt.pos})`);

                // If the first packet is WAY off (e.g. 0 when we asked for 90), seeking failed
                if (firstPts < (startTime - 20)) {
                    console.warn(`[HLS Proxy] Seek failed? Requested ${startTime}s, got ${firstPts}s.`);
                    // If we are somewhat close (e.g. 70s for 90s), we might accept it? 
                    // No, 20s drift is too much.
                    return resolve(0);
                }

                // Find the first packet >= startTime
                const packet = data.packets.find(p => parseFloat(p.pts_time) >= startTime);

                if (packet && packet.pos) {
                    console.log(`[HLS Proxy] Found precise offset: ${packet.pos} (pts: ${packet.pts_time})`);
                    resolve(parseInt(packet.pos));
                } else if (firstPkt.pos) {
                    // Fallback: If we couldn't find exact >= start, but we have *something* close (e.g. 88s for 90s)
                    // We take the closest one we have.
                    console.log(`[HLS Proxy] Exact >= seek failed, using closest packet at ${firstPts}s`);
                    resolve(parseInt(firstPkt.pos));
                } else {
                    resolve(0);
                }
            } catch (e) {
                console.error(`[HLS Proxy] Parse error: ${e.message}. Stderr: ${stderr}`);
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
function generateSmartManifest(videoUrl, duration, byteOffset, totalLength, startTime) {
    // Strategy: Use a "Fake Splice" to bypass player 'EXT-X-START' issues.
    // We send the file Header (0-1MB) to initialize the decoder, 
    // then jump (Splice) to the content at byteOffset.

    // Header Size: 1MB (Safe for MKV attachments/fonts, typically < 1s of video)
    const headerSize = 1000000;

    // If the skip is impossibly short, just play normal? No, we trust the offset.
    // If byteOffset < headerSize, we might duplicate data, but that's fine (just a slight loop).
    // Better to ensure we don't request negative ranges.

    const len2 = totalLength ? (totalLength - byteOffset) : 99999999999;

    let m3u8 = `#EXTM3U
#EXT-X-VERSION:4
#EXT-X-TARGETDURATION:${Math.ceil(duration || 7200)}
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-PLAYLIST-TYPE:VOD
#EXT-X-ALLOW-CACHE:YES

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
    return new Promise((resolve, reject) => {
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

        console.log(`[HLS Proxy] Probing splice points: ${startSec}s & ${endSec}s`);
        const proc = spawn(ffprobePath, args);

        const timeout = setTimeout(() => {
            console.warn(`[HLS Proxy] FFprobe splice probe timeout. Killing.`);
            proc.kill('SIGKILL');
            resolve(null);
        }, 20000); // 20s timeout

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data) => stdout += data);
        proc.stderr.on('data', (data) => stderr += data);

        proc.on('close', (code) => {
            clearTimeout(timeout);
            if (code !== 0) {
                console.warn(`[HLS Proxy] Probe failed code ${code}`);
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
                    console.log(`[HLS Proxy] Splice points found: ${startPkt.pts_time}s (${startPkt.pos}) -> ${endPkt.pts_time}s (${endPkt.pos})`);
                    return resolve({
                        startOffset: parseInt(startPkt.pos),
                        endOffset: parseInt(endPkt.pos)
                    });
                } else {
                    console.warn(`[HLS Proxy] Could not find packets for both ${startSec} and ${endSec}`);
                    resolve(null);
                }
            } catch (e) {
                console.error(`[HLS Proxy] Parse error: ${e.message}`);
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

        console.log(`[HLS Proxy] Probing chapters for ${url}...`);
        const proc = spawn(ffprobePath, args);

        const timeout = setTimeout(() => {
            console.warn(`[HLS Proxy] FFprobe chapter probe timeout. Killing.`);
            proc.kill('SIGKILL');
            resolve([]);
        }, 10000); // 10s timeout

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data) => stdout += data);
        proc.stderr.on('data', (data) => stderr += data);

        proc.on('close', (code) => {
            clearTimeout(timeout);
            if (code !== 0) {
                console.warn(`[HLS Proxy] Chapter probe failed code ${code}. Stderr: ${stderr}`);
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

                console.log(`[HLS Proxy] Found ${chapters.length} chapters.`);
                resolve(chapters);
            } catch (e) {
                console.error(`[HLS Proxy] Chapter parse error: ${e.message}`);
                resolve([]);
            }
        });
    });
}

function generateSpliceManifest(videoUrl, duration, startOffset, endOffset, totalLength) {
    // Segment 1: 0 to startOffset
    // Segment 2: endOffset to End

    const len1 = startOffset; // From 0 to startOffset
    const len2 = totalLength ? (totalLength - endOffset) : 99999999999;

    return `#EXTM3U
#EXT-X-VERSION:4
#EXT-X-TARGETDURATION:7200
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-PLAYLIST-TYPE:VOD
#EXT-X-ALLOW-CACHE:YES

#EXTINF:100,
#EXT-X-BYTERANGE:${len1}@0
${videoUrl}

#EXT-X-DISCONTINUITY

#EXTINF:7100,
#EXT-X-BYTERANGE:${len2}@${endOffset}
${videoUrl}

#EXT-X-ENDLIST`;
}

module.exports = {
    getStreamDetails,
    getByteOffset,
    generateSmartManifest,
    getRefinedOffsets,
    generateSpliceManifest,
    getChapters
};

const { spawn } = require('child_process');
const axios = require('axios');
const { PROBE } = require('../config/constants');
const log = require('../utils/logger').hls;
let ffprobePath = 'ffprobe';




try {
    if (process.platform === 'win32') {
        ffprobePath = require('ffprobe-static').path;
    }
} catch { }

const { getCachedProbe, setCachedProbe } = require('./cache-service');



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


async function getStreamDetails(url) {
    if (!isSafeUrl(url)) return { finalUrl: url, contentLength: null };
    try {
        const response = await axios.head(url, {
            maxRedirects: 10,
            validateStatus: (status) => status >= 200 && status < 400
        });





        return {
            finalUrl: response.request.res ? response.request.res.responseUrl : url,
            contentLength: response.headers['content-length'] ? parseInt(response.headers['content-length']) : null
        };
    } catch (e) {
        log.warn({ err: e.message }, 'HEAD request failed. Using original URL.');
        return { finalUrl: url, contentLength: null };
    }
}


async function getByteOffset(url, startTime) {
    const cacheKey = `byte:${url}:${startTime}`;
    const cached = getCachedProbe(cacheKey);
    if (cached !== null) {
        log.info({ startTime }, 'Using cached byte offset');
        return cached;
    }

    return new Promise((resolve) => {




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


                const firstPkt = data.packets[0];
                const firstPts = parseFloat(firstPkt.pts_time);
                log.info({ firstPts, pos: firstPkt.pos }, 'First packet found');


                if (firstPts < (startTime - 20)) {
                    log.warn({ startTime, firstPts }, 'Seek failed? Requested time significantly different from first packet.');


                    return resolve(0);
                }


                const packet = data.packets.find(p => parseFloat(p.pts_time) >= startTime);

                if (packet && packet.pos) {
                    log.info({ pos: packet.pos, pts: packet.pts_time }, 'Found precise offset');
                    const pos = parseInt(packet.pos);
                    setCachedProbe(cacheKey, pos);
                    resolve(pos);
                } else if (firstPkt.pos) {


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


function generateSmartManifest(videoUrl, duration, byteOffset, totalLength) {





    const headerSize = 1000000;





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


async function getRefinedOffsets(url, startSec, endSec) {
    const cacheKey = `refined:${url}:${startSec}:${endSec}`;
    const cached = getCachedProbe(cacheKey);
    if (cached) {
        log.info({ startSec, endSec }, 'Using cached refined offsets');
        return cached;
    }

    return new Promise((resolve) => {



        const interval = `${startSec}%+10,${endSec}%+10`;

        const args = [
            '-read_intervals', interval,
            '-select_streams', 'v:0',
            '-show_entries', 'packet=pos,pts_time',
            '-show_packets',
            '-analyzeduration', '10000000',
            '-probesize', '10000000',
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


                const findPacket = (target) => {

                    let p = data.packets.find(pkt => parseFloat(pkt.pts_time) >= target);

                    if (!p) {


                        const candidates = data.packets.filter(pkt => Math.abs(parseFloat(pkt.pts_time) - target) < 10);
                        if (candidates.length > 0) p = candidates[0];
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

function generateSpliceManifest(videoUrl, duration, startOffset, endOffset, totalLength, introStart, introEnd) {

    const len1 = startOffset;
    const len2 = totalLength ? (totalLength - endOffset) : 99999999999;

    const dur1 = Math.max(1, Math.ceil(introStart || 1));
    const dur2 = Math.max(1, Math.ceil((duration || 7200) - (introEnd || 0)));

    return `#EXTM3U
#EXT-X-VERSION:4
#EXT-X-TARGETDURATION:${Math.max(dur1, dur2)}
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-PLAYLIST-TYPE:VOD
#EXT-X-ALLOW-CACHE:YES

#EXTINF:${dur1},
#EXT-X-BYTERANGE:${len1}@0
${videoUrl}

#EXT-X-DISCONTINUITY

#EXTINF:${dur2},
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

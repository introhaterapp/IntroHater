const axios = require('axios');
const log = require('../utils/logger').hls;
const { detectContainer } = require('../utils/container-detection');

const EPISODE_PATTERNS = (season, episode) => [
    new RegExp(`[Ss]0*${season}[Ee]0*${episode}(?:[^0-9]|$)`, 'i'),
    new RegExp(`(?:^|[^0-9])${season}x0*${episode}(?:[^0-9]|$)`, 'i'),
    new RegExp(`[Ee]pisode[._\\s-]?0*${episode}(?:[^0-9]|$)`, 'i'),
    new RegExp(`(?:^|[._\\s-])E0*${episode}(?:[^0-9]|$)`, 'i')
];

function getFileName(file) {
    if (file.path) return file.path.split('/').pop();
    return file.name || file.short_name || '';
}

function isMp4File(fileName) {
    const lower = fileName.toLowerCase();
    return lower.endsWith('.mp4') || lower.endsWith('.m4v');
}

function pickBestFileIndex(files, { targetSeason, targetEpisode, preferMp4 }) {
    if (!files || files.length === 0) return 0;

    let candidates = files.map((file, index) => ({
        index,
        file,
        fileName: getFileName(file),
        size: file.bytes || file.size || 0
    }));

    if (targetSeason !== null && targetEpisode !== null) {
        const episodeMatches = [];
        for (const c of candidates) {
            for (const pattern of EPISODE_PATTERNS(targetSeason, targetEpisode)) {
                if (pattern.test(c.fileName)) {
                    episodeMatches.push(c);
                    break;
                }
            }
        }
        if (episodeMatches.length > 0) {
            candidates = episodeMatches;
        }
    }

    if (preferMp4) {
        const mp4Candidates = candidates.filter((c) => isMp4File(c.fileName));
        if (mp4Candidates.length > 0) {
            candidates = mp4Candidates;
        }
    }

    candidates.sort((a, b) => b.size - a.size);
    const selected = candidates[0];
    log.info(`[DebridResolver] Selected file: ${selected.fileName} (container: ${detectContainer(selected.fileName)})`);
    return selected.index;
}

function pickBestTorBoxFile(files, { targetSeason, targetEpisode, preferMp4 }) {
    if (!files || files.length === 0) return null;

    let candidates = files.map((file) => ({
        file,
        fileName: getFileName(file),
        size: file.size || 0
    }));

    if (targetSeason !== null && targetEpisode !== null) {
        const episodeMatches = [];
        for (const c of candidates) {
            for (const pattern of EPISODE_PATTERNS(targetSeason, targetEpisode)) {
                if (pattern.test(c.fileName)) {
                    episodeMatches.push(c);
                    break;
                }
            }
        }
        if (episodeMatches.length > 0) {
            candidates = episodeMatches;
        }
    }

    if (preferMp4) {
        const mp4Candidates = candidates.filter((c) => isMp4File(c.fileName));
        if (mp4Candidates.length > 0) {
            candidates = mp4Candidates;
        }
    }

    candidates.sort((a, b) => b.size - a.size);
    const selected = candidates[0];
    log.info(`[DebridResolver:TorBox] Selected file: ${selected.fileName} (container: ${detectContainer(selected.fileName)})`);
    return selected.file;
}

async function resolveInfoHash(provider, key, infoHash, options = {}) {
    if (!provider || !key || !infoHash) return null;

    try {
        if (provider === 'realdebrid') {
            return await resolveRD(key, infoHash, options);
        } else if (provider === 'torbox') {
            return await resolveTorBox(key, infoHash, options);
        }
        return null;
    } catch (e) {
        log.error({ err: e.message, provider, infoHash }, 'Debrid resolution failed');
        return null;
    }
}

async function resolveRD(key, infoHash, options = {}) {
    const { transcode, skipRequested, preferMp4, videoId } = options;
    const logPrefix = `[DebridResolver:RD]`;
    const useTranscode = transcode && !skipRequested;

    const addRes = await axios.post('https://api.real-debrid.com/rest/1.0/torrents/addMagnet',
        `magnet=magnet:?xt=urn:btih:${infoHash}`, {
        headers: {
            'Authorization': `Bearer ${key}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        }
    });

    const torrentId = addRes.data.id;
    if (!torrentId) return null;

    await axios.post(`https://api.real-debrid.com/rest/1.0/torrents/selectFiles/${torrentId}`,
        'files=all', {
        headers: {
            'Authorization': `Bearer ${key}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        }
    });

    const infoRes = await axios.get(`https://api.real-debrid.com/rest/1.0/torrents/info/${torrentId}`, {
        headers: { 'Authorization': `Bearer ${key}` }
    });

    const files = infoRes.data.files || [];
    const links = infoRes.data.links || [];

    if (links.length === 0) return null;

    let targetSeason = null;
    let targetEpisode = null;

    if (videoId && videoId.includes(':')) {
        const parts = videoId.split(':');
        if (parts.length >= 3) {
            targetSeason = parseInt(parts[1], 10);
            targetEpisode = parseInt(parts[2], 10);
        }
    }

    let selectedIndex = 0;

    if (files.length > 0 && links.length === files.length) {
        if (targetSeason !== null && targetEpisode !== null) {
            log.info(`${logPrefix} Looking for S${String(targetSeason).padStart(2, '0')}E${String(targetEpisode).padStart(2, '0')}`);
        }
        selectedIndex = pickBestFileIndex(files, { targetSeason, targetEpisode, preferMp4 });
    }

    const unrestrictRes = await axios.post('https://api.real-debrid.com/rest/1.0/unrestrict/link',
        `link=${encodeURIComponent(links[selectedIndex])}`, {
        headers: {
            'Authorization': `Bearer ${key}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        }
    });

    const unrestrictedId = unrestrictRes.data.id;
    const downloadUrl = unrestrictRes.data.download;

    if (useTranscode && unrestrictedId) {
        try {
            log.info(`${logPrefix} Requesting transcoded stream for file ${unrestrictedId}`);
            const streamRes = await axios.get(`https://api.real-debrid.com/rest/1.0/streaming/transcode/${unrestrictedId}`, {
                headers: { 'Authorization': `Bearer ${key}` }
            });

            if (streamRes.data?.apple?.full) {
                log.info(`${logPrefix} Got HLS URL from RD transcode`);
                return streamRes.data.apple.full;
            }
            if (streamRes.data?.h264WebM?.full) {
                return streamRes.data.h264WebM.full;
            }
            log.warn(`${logPrefix} Transcode response did not contain expected formats, falling back to download URL`);
        } catch (e) {
            log.warn(`${logPrefix} Transcode failed: ${e.message}, falling back to download URL`);
        }
    }

    return downloadUrl;
}

async function resolveTorBox(key, infoHash, options = {}) {
    const { transcode, skipRequested, preferMp4, videoId } = options;
    const logPrefix = `[DebridResolver:TorBox]`;
    const useTranscode = transcode && !skipRequested;

    let targetSeason = null;
    let targetEpisode = null;
    if (videoId && videoId.includes(':')) {
        const parts = videoId.split(':');
        if (parts.length >= 3) {
            targetSeason = parseInt(parts[1], 10);
            targetEpisode = parseInt(parts[2], 10);
            log.info(`${logPrefix} Looking for S${String(targetSeason).padStart(2, '0')}E${String(targetEpisode).padStart(2, '0')}`);
        }
    }

    try {
        let torrentId;
        try {
            const addRes = await axios.post('https://api.torbox.app/v1/api/torrents/createtorrent',
                { magnet: `magnet:?xt=urn:btih:${infoHash}`, seed: 1, allow_zip: false },
                { headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'multipart/form-data' } }
            );

            if (addRes.data.success) {
                torrentId = addRes.data.data.torrent_id;
            }
        } catch {
            // fall through to list check
        }

        if (!torrentId) {
            const listRes = await axios.get('https://api.torbox.app/v1/api/torrents/mylist?bypass_cache=true', {
                headers: { Authorization: `Bearer ${key}` }
            });
            if (listRes.data && listRes.data.data) {
                const found = listRes.data.data.find(t => t.hash.toLowerCase() === infoHash.toLowerCase());
                if (found) torrentId = found.id;
            }
        }

        if (!torrentId) {
            log.warn(`${logPrefix} Could not find torrent ID for hash ${infoHash}`);
            return null;
        }

        let fileId = null;

        try {
            const checkRes = await axios.get(`https://api.torbox.app/v1/api/torrents/checkcached?hash=${infoHash}&format=object&list_files=true`, {
                headers: { Authorization: `Bearer ${key}` }
            });

            let cachedItem = null;
            if (checkRes.data && checkRes.data.data) {
                cachedItem = checkRes.data.data[infoHash] || checkRes.data.data[infoHash.toLowerCase()];
            }

            if (cachedItem && cachedItem.files && cachedItem.files.length > 0) {
                const picked = pickBestTorBoxFile(cachedItem.files, { targetSeason, targetEpisode, preferMp4 });
                if (picked) {
                    fileId = picked.id || picked.file_id || picked.idx;
                    if (fileId != null) {
                        log.info(`${logPrefix} Got file ID ${fileId} from checkcached`);
                    }
                }
            }
        } catch (e) {
            log.warn(`${logPrefix} checkcached failed: ${e.message}`);
        }

        if (fileId === null || fileId === undefined) {
            try {
                const infoRes = await axios.get('https://api.torbox.app/v1/api/torrents/mylist?bypass_cache=true', {
                    headers: { Authorization: `Bearer ${key}` }
                });

                if (infoRes.data && infoRes.data.data) {
                    const torrent = infoRes.data.data.find(t => t.id === torrentId || t.hash?.toLowerCase() === infoHash.toLowerCase());
                    if (torrent && torrent.files && torrent.files.length > 0) {
                        const targetFile = pickBestTorBoxFile(torrent.files, { targetSeason, targetEpisode, preferMp4 })
                            || torrent.files.reduce((prev, current) => (prev.size > current.size) ? prev : current);

                        fileId = targetFile.id || targetFile.file_id || targetFile.idx || 0;
                        log.info(`${logPrefix} Got file ID ${fileId} from mylist`);
                    }
                }
            } catch (e) {
                log.warn(`${logPrefix} mylist file lookup failed: ${e.message}`);
            }
        }

        if (fileId === null || fileId === undefined) {
            log.warn(`${logPrefix} Could not determine file ID, using default 0`);
            fileId = 0;
        }

        if (useTranscode) {
            log.info(`${logPrefix} Requesting transcoded stream for torrent ${torrentId}, file ${fileId}`);
            try {
                const streamRes = await axios.get('https://api.torbox.app/v1/api/stream/createstream', {
                    params: { id: torrentId, file_id: fileId, type: 'torrent' },
                    headers: { Authorization: `Bearer ${key}` },
                    timeout: 15000
                });

                if (streamRes.data.success && streamRes.data.data) {
                    if (streamRes.data.data.hls_url) {
                        log.info(`${logPrefix} ✅ Got HLS transcode URL`);
                        return streamRes.data.data.hls_url;
                    }
                    if (streamRes.data.data.player) {
                        log.info(`${logPrefix} ✅ Got player URL`);
                        return streamRes.data.data.player;
                    }
                }
                log.warn(`${logPrefix} createstream response missing HLS: ${JSON.stringify(streamRes.data)}`);
            } catch (streamErr) {
                log.warn(`${logPrefix} createstream failed: ${streamErr.message}`);
            }

            log.info(`${logPrefix} ⚠️ Transcode unavailable, falling back to download link`);
        }

        try {
            const dlRes = await axios.get('https://api.torbox.app/v1/api/torrents/requestdl', {
                params: { token: key, torrent_id: torrentId, file_id: fileId },
                validateStatus: false,
                timeout: 10000
            });

            if (dlRes.data.success && dlRes.data.data) {
                log.info(`${logPrefix} ✅ Got download URL`);
                return dlRes.data.data;
            }
            log.warn(`${logPrefix} requestdl failed: ${JSON.stringify(dlRes.data)}`);
        } catch (dlErr) {
            log.error(`${logPrefix} requestdl error: ${dlErr.message}`);
        }

        return null;

    } catch (e) {
        log.error({ err: e.message, infoHash }, `${logPrefix} Resolution failed`);
        return null;
    }
}

module.exports = { resolveInfoHash, pickBestFileIndex, pickBestTorBoxFile };

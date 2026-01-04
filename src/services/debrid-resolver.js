const axios = require('axios');
const log = require('../utils/logger').hls;

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
    const { transcode } = options;
    const logPrefix = `[DebridResolver:RD]`;

    // 1. Add magnet
    const addRes = await axios.post('https://api.real-debrid.com/rest/1.0/torrents/addMagnet',
        `magnet=magnet:?xt=urn:btih:${infoHash}`, {
        headers: {
            'Authorization': `Bearer ${key}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        }
    });

    const torrentId = addRes.data.id;
    if (!torrentId) return null;

    // 2. Select files (select all for simplicity in auto-skip context)
    await axios.post(`https://api.real-debrid.com/rest/1.0/torrents/selectFiles/${torrentId}`,
        'files=all', {
        headers: {
            'Authorization': `Bearer ${key}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        }
    });

    // 3. Get info
    const infoRes = await axios.get(`https://api.real-debrid.com/rest/1.0/torrents/info/${torrentId}`, {
        headers: { 'Authorization': `Bearer ${key}` }
    });

    // 4. Find the best file (Episode match or Largest)
    const files = infoRes.data.files || [];
    const links = infoRes.data.links || [];

    if (links.length === 0) return null;

    let selectedIndex = 0;

    // Extract season/episode from videoId for matching
    const { videoId } = options;
    let targetSeason = null;
    let targetEpisode = null;

    if (videoId && videoId.includes(':')) {
        const parts = videoId.split(':');
        if (parts.length >= 3) {
            targetSeason = parseInt(parts[1], 10);
            targetEpisode = parseInt(parts[2], 10);
        }
    }

    if (files.length > 0 && links.length === files.length) {
        let matchedFile = null;

        // Try episode matching first
        if (targetSeason !== null && targetEpisode !== null) {
            log.info(`${logPrefix} Looking for S${String(targetSeason).padStart(2, '0')}E${String(targetEpisode).padStart(2, '0')}`);

            const episodePatterns = [
                new RegExp(`[Ss]0*${targetSeason}[Ee]0*${targetEpisode}(?:[^0-9]|$)`, 'i'),
                new RegExp(`(?:^|[^0-9])${targetSeason}x0*${targetEpisode}(?:[^0-9]|$)`, 'i'),
                new RegExp(`[Ee]pisode[._\\s-]?0*${targetEpisode}(?:[^0-9]|$)`, 'i'),
                new RegExp(`(?:^|[._\\s-])E0*${targetEpisode}(?:[^0-9]|$)`, 'i')
            ];

            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const fileName = file.path.split('/').pop();

                for (const pattern of episodePatterns) {
                    if (pattern.test(fileName)) {
                        matchedFile = { index: i, ...file };
                        log.info(`${logPrefix} Matched episode file: ${fileName}`);
                        break;
                    }
                }
                if (matchedFile) break;
            }
        }

        // Fallback to largest file
        if (!matchedFile) {
            let largestSize = 0;
            files.forEach((file, index) => {
                if (file.bytes > largestSize) {
                    largestSize = file.bytes;
                    selectedIndex = index;
                }
            });
            log.info(`${logPrefix} Using largest file (Index ${selectedIndex})`);
        } else {
            selectedIndex = matchedFile.index;
        }
    }

    // 5. Unrestrict link
    const unrestrictRes = await axios.post('https://api.real-debrid.com/rest/1.0/unrestrict/link',
        `link=${encodeURIComponent(links[selectedIndex])}`, {
        headers: {
            'Authorization': `Bearer ${key}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        }
    });

    const unrestrictedId = unrestrictRes.data.id;
    const downloadUrl = unrestrictRes.data.download;

    // 6. If transcode requested, try to get HLS stream
    if (transcode && unrestrictedId) {
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
    const { transcode, videoId } = options;
    const logPrefix = `[DebridResolver:TorBox]`;

    // Extract season/episode from videoId (e.g. tt0944947:1:3 → S01E03)
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
        // Step 1: Add magnet to ensure it's in the account and get ID
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
            // If add fails, fall through to list check
        }

        if (!torrentId) {
            // Use bypass_cache=true to see recently added torrents
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

        // Step 2: Get File ID (Largest file)
        let fileId = null;

        // Try checkcached first
        try {
            const checkRes = await axios.get(`https://api.torbox.app/v1/api/torrents/checkcached?hash=${infoHash}&format=object&list_files=true`, {
                headers: { Authorization: `Bearer ${key}` }
            });

            let cachedItem = null;
            if (checkRes.data && checkRes.data.data) {
                cachedItem = checkRes.data.data[infoHash] || checkRes.data.data[infoHash.toLowerCase()];
            }

            if (cachedItem && cachedItem.files && cachedItem.files.length > 0) {
                const largestFile = cachedItem.files.reduce((prev, current) => (prev.size > current.size) ? prev : current);
                // TorBox API sometimes uses 'id', 'file_id', or 'idx' 
                fileId = largestFile.id || largestFile.file_id || largestFile.idx;
                if (fileId) {
                    log.info(`${logPrefix} Got file ID ${fileId} from checkcached`);
                }
            }
        } catch (e) {
            log.warn(`${logPrefix} checkcached failed: ${e.message}`);
        }

        // Fallback: Get file list from torrent info
        if (!fileId) {
            try {
                const infoRes = await axios.get(`https://api.torbox.app/v1/api/torrents/mylist?bypass_cache=true`, {
                    headers: { Authorization: `Bearer ${key}` }
                });

                if (infoRes.data && infoRes.data.data) {
                    const torrent = infoRes.data.data.find(t => t.id === torrentId || t.hash?.toLowerCase() === infoHash.toLowerCase());
                    if (torrent && torrent.files && torrent.files.length > 0) {
                        let targetFile = null;

                        // Try to match episode if we have season/episode info
                        if (targetSeason !== null && targetEpisode !== null) {
                            // Patterns ordered from strictest to loosest
                            const episodePatterns = [
                                // S01E03, S1E03, S01E3 - most reliable
                                new RegExp(`[Ss]0*${targetSeason}[Ee]0*${targetEpisode}(?:[^0-9]|$)`, 'i'),
                                // 1x03 format
                                new RegExp(`(?:^|[^0-9])${targetSeason}x0*${targetEpisode}(?:[^0-9]|$)`, 'i'),
                                // Episode.03 or Episode 3
                                new RegExp(`[Ee]pisode[._\\s-]?0*${targetEpisode}(?:[^0-9]|$)`, 'i'),
                                // E03 standalone (only in filename, not path)
                                new RegExp(`(?:^|[._\\s-])E0*${targetEpisode}(?:[^0-9]|$)`, 'i')
                            ];

                            for (const file of torrent.files) {
                                const fileName = file.name || file.short_name || '';
                                for (const pattern of episodePatterns) {
                                    if (pattern.test(fileName)) {
                                        targetFile = file;
                                        log.info(`${logPrefix} Matched episode file: ${fileName}`);
                                        break;
                                    }
                                }
                                if (targetFile) break;
                            }
                        }

                        // Fallback to largest file if no episode match
                        if (!targetFile) {
                            targetFile = torrent.files.reduce((prev, current) => (prev.size > current.size) ? prev : current);
                            log.warn(`${logPrefix} No episode match, using largest file: ${targetFile.name || targetFile.short_name}`);
                        }

                        fileId = targetFile.id || targetFile.file_id || targetFile.idx || 0;
                        log.info(`${logPrefix} Got file ID ${fileId} from mylist`);
                    }
                }
            } catch (e) {
                log.warn(`${logPrefix} mylist file lookup failed: ${e.message}`);
            }
        }

        // Last resort: use 0 as default file ID (first/largest file)
        if (fileId === null || fileId === undefined) {
            log.warn(`${logPrefix} Could not determine file ID, using default 0`);
            fileId = 0;
        }

        // Step 3: Get Stream/Download Link
        if (transcode) {
            // Request Transcoded HLS Stream
            log.info(`${logPrefix} Requesting transcoded stream for torrent ${torrentId}, file ${fileId}`);
            const streamRes = await axios.get(`https://api.torbox.app/v1/api/stream/createstream`, {
                params: { id: torrentId, file_id: fileId, type: 'torrent' },
                headers: { Authorization: `Bearer ${key}` }
            });

            if (streamRes.data.success && streamRes.data.data) {
                if (streamRes.data.data.hls_url) {
                    return streamRes.data.data.hls_url;
                }
                if (streamRes.data.data.player) return streamRes.data.data.player;
            }
            log.warn(`${logPrefix} Failed to create stream: ${JSON.stringify(streamRes.data)}`);
            return null;
        } else {
            // Request Download Link 
            const dlRes = await axios.get('https://api.torbox.app/v1/api/torrents/requestdl', {
                params: { token: key, torrent_id: torrentId, file_id: fileId },
                validateStatus: false
            });

            if (dlRes.data.success && dlRes.data.data) {
                return dlRes.data.data;
            }
            return null;
        }

    } catch (e) {
        log.error({ err: e.message, infoHash }, `${logPrefix} Resolution failed`);
        return null;
    }
}

module.exports = { resolveInfoHash };

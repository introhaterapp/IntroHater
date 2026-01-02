const axios = require('axios');
const log = require('../utils/logger').hls;

async function resolveInfoHash(provider, key, infoHash, options = {}) {
    if (!provider || !key || !infoHash) return null;

    try {
        if (provider === 'realdebrid') {
            return await resolveRD(key, infoHash);
        } else if (provider === 'torbox') {
            return await resolveTorBox(key, infoHash, options);
        }
        // Add others if needed
        return null;
    } catch (e) {
        log.error({ err: e.message, provider, infoHash }, 'Debrid resolution failed');
        return null;
    }
}

async function resolveRD(key, infoHash) {
    // 1. Add magnet
    const addRes = await axios.post('https://api.real-debrid.com/rest/1.0/torrents/addMagnet',
        `magnet:?xt=urn:btih:${infoHash}`, {
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

    // 4. Find the largest file (likely the movie/episode)
    const links = infoRes.data.links || [];
    if (links.length === 0) return null;

    // 5. Unrestrict link
    const unrestrictRes = await axios.post('https://api.real-debrid.com/rest/1.0/unrestrict/link',
        `link=${links[0]}`, {
        headers: {
            'Authorization': `Bearer ${key}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        }
    });

    return unrestrictRes.data.download;
}

async function resolveTorBox(key, infoHash, options = {}) {
    const { transcode } = options;
    const logPrefix = `[DebridResolver:TorBox]`;

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
        // Use checkcached to get file structure
        const checkRes = await axios.get(`https://api.torbox.app/v1/api/torrents/checkcached?hash=${infoHash}&format=object&list_files=true`, {
            headers: { Authorization: `Bearer ${key}` }
        });

        let cachedItem = null;
        if (checkRes.data && checkRes.data.data) {
            cachedItem = checkRes.data.data[infoHash] || checkRes.data.data[infoHash.toLowerCase()];
        }

        if (!cachedItem || !cachedItem.files || cachedItem.files.length === 0) {
            // Fallback to mylist files if checkcached fails (some private torrents?)
            // But checkcached is usually reliable for metadata
            log.warn(`${logPrefix} Torrent not found in cache or no files`);
            return null;
        }

        const largestFile = cachedItem.files.reduce((prev, current) => (prev.size > current.size) ? prev : current);
        const fileId = largestFile.id;

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

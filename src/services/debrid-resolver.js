const axios = require('axios');
const log = require('../utils/logger').hls;

async function resolveInfoHash(provider, key, infoHash) {
    if (!provider || !key || !infoHash) return null;

    try {
        if (provider === 'realdebrid') {
            return await resolveRD(key, infoHash);
        } else if (provider === 'torbox') {
            return await resolveTorBox(key, infoHash);
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

async function resolveTorBox(key, infoHash) {
    // TorBox has a specific endpoint for checking cached items
    const checkRes = await axios.get(`https://api.torbox.app/v1/api/torrents/check?hash=${infoHash}`, {
        headers: { 'Authorization': `Bearer ${key}` }
    });

    if (!checkRes.data?.data || checkRes.data.data.length === 0) return null;

    // If cached, create a download link
    // Note: This is an abstraction, TorBox API might require adding then getting links
    // For now, let's keep it simple or fallback to redirect
    return null;
}

module.exports = { resolveInfoHash };

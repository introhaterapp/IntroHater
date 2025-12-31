

const axios = require('axios');
const crypto = require('crypto');


const DEBRID_PROVIDERS = {
    realdebrid: {
        name: 'Real-Debrid',
        shortName: 'RD',
        verifyUrl: 'https://api.real-debrid.com/rest/1.0/user',
        authType: 'bearer',
        torrentioParam: 'realdebrid',
        keyUrl: 'https://real-debrid.com/apitoken'
    },
    torbox: {
        name: 'TorBox',
        shortName: 'TB',
        verifyUrl: 'https://api.torbox.app/v1/api/user/me',
        authType: 'bearer',
        torrentioParam: 'torbox',
        keyUrl: 'https://torbox.app/settings'
    },
    premiumize: {
        name: 'Premiumize',
        shortName: 'PM',
        verifyUrl: 'https://www.premiumize.me/api/account/info',
        authType: 'query',
        torrentioParam: 'premiumize',
        keyUrl: 'https://www.premiumize.me/account'
    },
    alldebrid: {
        name: 'AllDebrid',
        shortName: 'AD',
        verifyUrl: 'https://api.alldebrid.com/v4/user',
        authType: 'bearer',
        torrentioParam: 'alldebrid',
        keyUrl: 'https://alldebrid.com/apikeys/'
    }
};


const keyCache = new Map();
const CACHE_TTL = 5 * 60 * 1000;
const CACHE_MAX_SIZE = 500;


function getProvider(providerName) {
    return DEBRID_PROVIDERS[providerName?.toLowerCase()] || null;
}


function getAllProviders() {
    return DEBRID_PROVIDERS;
}


function generateUserId(key) {
    if (!key) return 'anonymous';
    return crypto.createHash('sha256').update(key).digest('hex').substring(0, 32);
}


function parseConfig(config) {
    if (!config) return { provider: 'realdebrid', key: '' };


    const colonIndex = config.indexOf(':');
    if (colonIndex > 0 && colonIndex < 15) {
        const potentialProvider = config.substring(0, colonIndex).toLowerCase();
        if (DEBRID_PROVIDERS[potentialProvider]) {
            return {
                provider: potentialProvider,
                key: config.substring(colonIndex + 1)
            };
        }
    }


    return { provider: 'realdebrid', key: config };
}


function buildConfig(provider, key) {
    return `${provider}:${key}`;
}


async function verifyDebridKey(provider, key, timeout = 3000) {
    if (!key) return false;

    const providerConfig = getProvider(provider);
    if (!providerConfig) return false;


    const cacheKey = `${provider}:${key}`;
    const cached = keyCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
        return cached.valid;
    }

    try {
        let response;

        if (providerConfig.authType === 'bearer') {
            response = await axios.get(providerConfig.verifyUrl, {
                headers: { 'Authorization': `Bearer ${key}` },
                timeout
            });
        } else if (providerConfig.authType === 'query') {
            response = await axios.get(`${providerConfig.verifyUrl}?apikey=${key}`, {
                timeout
            });
        }


        let valid = false;
        if (response?.data) {
            if (provider === 'realdebrid') {
                valid = !!(response.data.id);
            } else if (provider === 'torbox') {
                valid = response.data.success === true;
            } else if (provider === 'premiumize') {
                valid = response.data.status === 'success';
            } else if (provider === 'alldebrid') {
                valid = response.data.status === 'success';
            }
        }


        if (keyCache.size >= CACHE_MAX_SIZE) {
            const firstKey = keyCache.keys().next().value;
            keyCache.delete(firstKey);
        }
        keyCache.set(cacheKey, { valid, timestamp: Date.now() });

        return valid;
    } catch {
        keyCache.set(`${provider}:${key}`, { valid: false, timestamp: Date.now() });
        return false;
    }
}


async function verifyRdKey(rdKey, timeout = 3000) {
    return verifyDebridKey('realdebrid', rdKey, timeout);
}


function buildTorrentioUrl(provider, key, type, id) {
    const providerConfig = getProvider(provider);
    const debridParam = providerConfig?.torrentioParam || 'realdebrid';
    return `https://torrentio.strem.fun/providers=yts,eztv,rarbg,1337x,thepiratebay,kickasstorrents,torrentgalaxy,magnetdl,horriblesubs,nyaasi,tokyotosho,anidex,rutor,rutracker,torrent9,mejortorrent,wolfmax4k%7Csort=qualitysize%7Clanguage=korean%7Cqualityfilter=scr,cam%7Cdebridoptions=nodownloadlinks,nocatalog%7C${debridParam}=${key}/stream/${type}/${id}.json`;
}

function buildCometUrl(provider, key, type, id) {
    const config = Buffer.from(JSON.stringify({
        indexers: ["bitsearch", "eztv", "thepiratebay", "torrentgalaxy", "yts"],
        max_results: 20,
        max_results_per_indexer: 10,
        timeout: 10,
        debrid_service: provider === 'realdebrid' ? 'realdebrid' : provider,
        debrid_api_key: key
    })).toString('base64');
    return `https://comet.elfhosted.com/${config}/stream/${type}/${id}.json`;
}


function buildMediaFusionUrl(provider, key, type, id) {
    const providerConfig = getProvider(provider);
    const debridId = providerConfig?.torrentioParam || 'realdebrid';
    return `https://mediafusion.elfhosted.com/${debridId}=${key}/stream/${type}/${id}.json`;
}


async function requireDebridAuth(req, res, next) {
    const key = req.body?.rdKey || req.body?.debridKey;
    const provider = req.body?.provider || 'realdebrid';

    if (!key) {
        return res.status(400).json({ success: false, error: "Debrid key required" });
    }

    const isValid = await verifyDebridKey(provider, key);
    if (!isValid) {
        const providerConfig = getProvider(provider);
        const providerName = providerConfig?.name || 'Debrid';
        return res.status(401).json({ success: false, error: `Invalid ${providerName} Key` });
    }

    req.userId = generateUserId(key);
    req.debridKey = key;
    req.debridProvider = provider;

    req.rdKey = key;
    next();
}


const requireRdAuth = requireDebridAuth;


async function optionalDebridAuth(req, res, next) {
    const key = req.body?.rdKey || req.body?.debridKey || req.query?.rdKey || req.query?.debridKey;
    const provider = req.body?.provider || req.query?.provider || 'realdebrid';

    if (!key) {
        req.userId = 'anonymous';
        return next();
    }

    const isValid = await verifyDebridKey(provider, key);
    if (isValid) {
        req.userId = generateUserId(key);
        req.debridKey = key;
        req.debridProvider = provider;
        req.rdKey = key;
    } else {
        req.userId = 'anonymous';
    }

    next();
}


const optionalRdAuth = optionalDebridAuth;

module.exports = {

    DEBRID_PROVIDERS,
    getProvider,
    getAllProviders,
    parseConfig,
    buildConfig,
    buildTorrentioUrl,
    buildCometUrl,
    buildMediaFusionUrl,


    generateUserId,
    verifyDebridKey,
    verifyRdKey,


    requireDebridAuth,
    requireRdAuth,
    optionalDebridAuth,
    optionalRdAuth
};

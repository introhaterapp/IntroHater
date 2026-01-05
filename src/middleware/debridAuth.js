

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





function buildConfig(provider, key) {
    return `${provider}:${key}`;
}


const parseConfig = (configStr) => {
    if (!configStr) return {};

    // Config format: provider:key[+provider2:key2][+provider3:key3][:s=BASE64][:p=BASE64][:pp=BASE64]
    // Examples:
    //   realdebrid:RDKEY
    //   realdebrid:RDKEY+torbox:TBKEY
    //   realdebrid:RDKEY+torbox:TBKEY:s=BASE64SCRAPER

    // First, separate provider configs from optional params (s=, p=, pp=)
    // Provider configs use + separator, optional params use : with prefix

    let scraper = null;
    let proxyUrl = null;
    let proxyPassword = null;
    const providers = {};

    // Split by : first to find optional params at the end
    const colonParts = configStr.split(':');

    // Find where optional params start (look for s=, p=, pp= prefixes)
    let optionalStartIdx = colonParts.length;
    for (let i = 0; i < colonParts.length; i++) {
        const part = colonParts[i];
        if (part.startsWith('s=') || part.startsWith('p=') || part.startsWith('pp=')) {
            optionalStartIdx = i;
            break;
        }
    }

    // Process optional params
    for (let i = optionalStartIdx; i < colonParts.length; i++) {
        const part = colonParts[i];
        if (part.startsWith('s=')) {
            try { scraper = Buffer.from(part.substring(2), 'base64').toString('utf8'); } catch { }
        } else if (part.startsWith('pp=')) {
            try { proxyPassword = Buffer.from(part.substring(3), 'base64').toString('utf8'); } catch { }
        } else if (part.startsWith('p=')) {
            try { proxyUrl = Buffer.from(part.substring(2), 'base64').toString('utf8'); } catch { }
        }
    }

    // Reconstruct provider config string (everything before optional params)
    const providerConfigStr = colonParts.slice(0, optionalStartIdx).join(':');

    // Split by + to get individual provider configs
    const providerConfigs = providerConfigStr.split('+');

    let primaryProvider = null;
    let primaryKey = null;

    for (const providerConfig of providerConfigs) {
        // Each provider config is "provider:key"
        const [prov, ...keyParts] = providerConfig.split(':');
        const key = keyParts.join(':'); // Handle keys that might contain :

        if (prov && key && DEBRID_PROVIDERS[prov.toLowerCase()]) {
            const normalizedProv = prov.toLowerCase();
            providers[normalizedProv] = key;

            // First valid provider is primary
            if (!primaryProvider) {
                primaryProvider = normalizedProv;
                primaryKey = key;
            }
        }
    }

    // Legacy fallback - if no valid providers found, treat entire string as RD key
    if (!primaryProvider) {
        return { provider: 'realdebrid', key: configStr, providers: { realdebrid: configStr }, scraper, proxyUrl, proxyPassword };
    }

    return {
        provider: primaryProvider,
        key: primaryKey,
        providers,
        scraper,
        proxyUrl,
        proxyPassword
    };
};


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
    const debridService = provider === 'realdebrid' ? 'realdebrid' : provider;
    const configObj = {
        indexers: ["bitsearch", "eztv", "thepiratebay", "torrentgalaxy", "yts"],
        maxResultsPerResolution: 5,
        debridService: debridService,
        debridApiKey: key
    };
    const config = Buffer.from(JSON.stringify(configObj)).toString('base64');
    return `https://comet.elfhosted.com/${config}/stream/${type}/${id}.json`;
}




function buildMediaFusionUrl(provider, key, type, id) {
    const debridService = provider === 'realdebrid' ? 'realdebrid' : provider;
    const config = Buffer.from(JSON.stringify({
        streaming_provider: {
            service: debridService,
            token: key
        }
    })).toString('base64');
    return `https://mediafusion.elfhosted.com/${config}/stream/${type}/${id}.json`;
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

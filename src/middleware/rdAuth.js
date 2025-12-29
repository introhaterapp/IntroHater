

const axios = require('axios');
const crypto = require('crypto');



const rdKeyCache = new Map();
const RD_CACHE_TTL = 5 * 60 * 1000; 
const RD_CACHE_MAX_SIZE = 500;


function generateUserId(rdKey) {
    if (!rdKey) return 'anonymous';
    return crypto.createHash('sha256').update(rdKey).digest('hex').substring(0, 32);
}


async function verifyRdKey(rdKey, timeout = 3000) {
    if (!rdKey) return false;

    
    const cached = rdKeyCache.get(rdKey);
    if (cached && (Date.now() - cached.timestamp) < RD_CACHE_TTL) {
        return cached.valid;
    }

    try {
        const response = await axios.get('https://api.real-debrid.com/rest/1.0/user', {
            headers: { 'Authorization': `Bearer ${rdKey}` },
            timeout
        });

        const valid = !!(response.data && response.data.id);

        
        if (rdKeyCache.size >= RD_CACHE_MAX_SIZE) {
            const firstKey = rdKeyCache.keys().next().value;
            rdKeyCache.delete(firstKey);
        }
        rdKeyCache.set(rdKey, { valid, timestamp: Date.now() });

        return valid;
    } catch {
        rdKeyCache.set(rdKey, { valid: false, timestamp: Date.now() });
        return false;
    }
}


async function requireRdAuth(req, res, next) {
    const rdKey = req.body?.rdKey;

    if (!rdKey) {
        return res.status(400).json({ success: false, error: "RD Key required" });
    }

    const isValid = await verifyRdKey(rdKey);
    if (!isValid) {
        return res.status(401).json({ success: false, error: "Invalid Real-Debrid Key" });
    }

    req.userId = generateUserId(rdKey);
    req.rdKey = rdKey;
    next();
}


async function optionalRdAuth(req, res, next) {
    const rdKey = req.body?.rdKey || req.query?.rdKey;

    if (!rdKey) {
        req.userId = 'anonymous';
        return next();
    }

    const isValid = await verifyRdKey(rdKey);
    if (isValid) {
        req.userId = generateUserId(rdKey);
        req.rdKey = rdKey;
    } else {
        req.userId = 'anonymous';
    }

    next();
}

module.exports = {
    generateUserId,
    verifyRdKey,
    requireRdAuth,
    optionalRdAuth
};

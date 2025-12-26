/**
 * Real-Debrid Authentication Middleware
 * Centralizes RD key verification to replace copy-pasted auth logic
 * @module middleware/rdAuth
 */

const axios = require('axios');
const crypto = require('crypto');

// RD Key Verification Cache (reduces API calls)
/** @type {Map<string, {valid: boolean, timestamp: number}>} */
const rdKeyCache = new Map();
const RD_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const RD_CACHE_MAX_SIZE = 500;

/**
 * Generate a user ID from an RD key
 * @param {string} rdKey - Real-Debrid API key
 * @returns {string} Hashed user ID (32 chars)
 */
function generateUserId(rdKey) {
    if (!rdKey) return 'anonymous';
    return crypto.createHash('sha256').update(rdKey).digest('hex').substring(0, 32);
}

/**
 * Verify a Real-Debrid API key (with caching)
 * @param {string} rdKey - Real-Debrid API key
 * @param {number} [timeout=3000] - Request timeout in ms
 * @returns {Promise<boolean>} Whether the key is valid
 */
async function verifyRdKey(rdKey, timeout = 3000) {
    if (!rdKey) return false;

    // Check cache first
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

        // Cache result (evict oldest if full)
        if (rdKeyCache.size >= RD_CACHE_MAX_SIZE) {
            const firstKey = rdKeyCache.keys().next().value;
            rdKeyCache.delete(firstKey);
        }
        rdKeyCache.set(rdKey, { valid, timestamp: Date.now() });

        return valid;
    } catch (e) {
        rdKeyCache.set(rdKey, { valid: false, timestamp: Date.now() });
        return false;
    }
}

/**
 * Middleware to verify Real-Debrid key from request body
 * Attaches userId to req on success
 * 
 * Usage: app.post('/api/endpoint', requireRdAuth, handler)
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
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

/**
 * Middleware to optionally verify RD key (doesn't fail if missing)
 * Attaches userId to req if valid, 'anonymous' otherwise
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
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

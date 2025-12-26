const rateLimit = require('express-rate-limit');
const apiKeyService = require('../services/apiKey');

// List of globally allowed API keys for public clients
const ALLOWED_PUBLIC_KEYS = {
    'introhater_mpv_client': {
        name: 'MPV Plugin Client',
        permissions: ['read:segments'],
        isAdminKey: false
    }
};

// API key authentication middleware
const apiKeyAuth = async (req, res, next) => {
    try {
        // Check for API key in headers
        const apiKey = req.headers['x-api-key'];

        if (!apiKey) {
            return res.status(401).json({ error: 'API key is required' });
        }

        // Check if this is a predefined public key
        if (ALLOWED_PUBLIC_KEYS[apiKey]) {
            // For predefined keys, skip database validation
            req.apiKey = {
                _id: `public_key_${apiKey}`,
                key: apiKey,
                ...ALLOWED_PUBLIC_KEYS[apiKey]
            };
            next();
            return;
        }

        // For all other keys, validate against the database
        const startTime = Date.now();
        const keyDetails = await apiKeyService.validateApiKey(apiKey);

        if (!keyDetails) {
            return res.status(401).json({ error: 'Invalid or expired API key' });
        }

        // Check permissions if endpoint requires specific permissions
        if (req.requiredPermissions && req.requiredPermissions.length > 0) {
            const hasPermission = req.requiredPermissions.every(permission =>
                keyDetails.permissions.includes(permission)
            );

            if (!hasPermission) {
                return res.status(403).json({ error: 'Insufficient permissions for this API' });
            }
        }

        // Store API key info for usage tracking and rate limiting bypass
        req.apiKey = keyDetails;

        // Setup response listener to track metrics
        const oldSend = res.send;
        res.send = function () {
            const responseTime = Date.now() - startTime;

            // Track API usage asynchronously
            apiKeyService.trackUsage(
                keyDetails._id,
                req.originalUrl,
                responseTime,
                res.statusCode
            ).catch(err => console.error('Error tracking API usage:', err));

            return oldSend.apply(this, arguments);
        };

        next();
    } catch (error) {
        console.error('API key authentication error:', error);
        res.status(500).json({ error: 'Authentication error' });
    }
};

// Rate limiting middleware
const createRateLimiter = (options = {}) => {
    const defaultOptions = {
        windowMs: parseInt(process.env.API_RATE_WINDOW_MS) || 15 * 60 * 1000,
        max: parseInt(process.env.API_RATE_LIMIT) || 100,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req) => {
            return req.apiKey?._id?.toString() || req.ip;
        },
        skip: (req) => {
            // Skip rate limiting for admin keys
            return req.apiKey?.isAdminKey === true;
        },
        handler: (req, res) => {
            res.status(429).json({
                error: 'Too many requests, please try again later.'
            });
        }
    };

    return rateLimit({ ...defaultOptions, ...options });
};

// Permission check middleware
const requirePermission = (permissions) => {
    if (!Array.isArray(permissions)) {
        permissions = [permissions];
    }

    return (req, res, next) => {
        req.requiredPermissions = permissions;
        next();
    };
};

// Admin check middleware with email validation
const validateAdminAccess = (req, res, next) => {
    try {
        if (!req.oidc || !req.oidc.isAuthenticated()) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(email => email.trim());
        if (!adminEmails.length) {
            console.error('No admin emails configured');
            return res.status(500).json({ error: 'Server configuration error' });
        }

        if (!req.oidc.user?.email || !adminEmails.includes(req.oidc.user.email)) {
            return res.status(403).json({ error: 'Admin access required' });
        }

        next();
    } catch (error) {
        console.error('Admin validation error:', error);
        res.status(500).json({ error: 'Admin validation failed' });
    }
};

module.exports = {
    apiKeyAuth,
    createRateLimiter,
    requirePermission,
    validateAdminAccess,
    ALLOWED_PUBLIC_KEYS  // Export the allowed keys list for use elsewhere
};
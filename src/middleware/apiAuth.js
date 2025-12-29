const rateLimit = require('express-rate-limit');
const apiKeyService = require('../services/apiKey');


const ALLOWED_PUBLIC_KEYS = {
    'introhater_mpv_client': {
        name: 'MPV Plugin Client',
        permissions: ['read:segments'],
        isAdminKey: false
    }
};


const apiKeyAuth = async (req, res, next) => {
    try {
        
        const apiKey = req.headers['x-api-key'];

        if (!apiKey) {
            return res.status(401).json({ error: 'API key is required' });
        }

        
        if (ALLOWED_PUBLIC_KEYS[apiKey]) {
            
            req.apiKey = {
                _id: `public_key_${apiKey}`,
                key: apiKey,
                ...ALLOWED_PUBLIC_KEYS[apiKey]
            };
            next();
            return;
        }

        
        const startTime = Date.now();
        const keyDetails = await apiKeyService.validateApiKey(apiKey);

        if (!keyDetails) {
            return res.status(401).json({ error: 'Invalid or expired API key' });
        }

        
        if (req.requiredPermissions && req.requiredPermissions.length > 0) {
            const hasPermission = req.requiredPermissions.every(permission =>
                keyDetails.permissions.includes(permission)
            );

            if (!hasPermission) {
                return res.status(403).json({ error: 'Insufficient permissions for this API' });
            }
        }

        
        req.apiKey = keyDetails;

        
        const oldSend = res.send;
        res.send = function () {
            const responseTime = Date.now() - startTime;

            
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


const requirePermission = (permissions) => {
    if (!Array.isArray(permissions)) {
        permissions = [permissions];
    }

    return (req, res, next) => {
        req.requiredPermissions = permissions;
        next();
    };
};


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
    ALLOWED_PUBLIC_KEYS  
};
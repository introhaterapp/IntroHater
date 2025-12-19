const { body, param, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const xss = require('xss');
const { SECURITY } = require('../config/constants');
const { verifyUserToken } = require('../utils/auth');

// XSS clean function
function cleanInput(input) {
    if (typeof input === 'string') {
        return xss(input);
    } else if (Array.isArray(input)) {
        return input.map(cleanInput);
    } else if (typeof input === 'object' && input !== null) {
        const cleaned = {};
        for (const [key, value] of Object.entries(input)) {
            cleaned[key] = cleanInput(value);
        }
        return cleaned;
    }
    return input;
}

// Input validation middleware
const validateSegmentInput = [
    body('videoId').matches(/^tt\d+(?::\d+:\d+)?$/).withMessage('Invalid video ID format'),
    body('start').isFloat({ min: 0 }).withMessage('Invalid start time'),
    body('end').isFloat({ min: 0 }).withMessage('Invalid end time'),
    body('category').isIn(['intro', 'outro']).withMessage('Invalid category'),
    body('userId').notEmpty().withMessage('Missing user ID'),
    body('token').isString().isLength({ min: SECURITY.TOKEN.MIN_LENGTH }).withMessage('Invalid token'),
    body('timestamp').isInt().withMessage('Invalid timestamp'),
    body('nonce').isString().isLength({ min: 32 }).withMessage('Invalid or missing nonce')
];

const validateGetSegments = [
    param('videoId').matches(/^tt\d+(?::\d+:\d+)?$/).withMessage('Invalid video ID format')
        .customSanitizer(value => decodeURIComponent(value)) // Add URL decoding
];

const validateVoteInput = [
    param('segmentId').isString().notEmpty().withMessage('Invalid segment ID'),
    body('vote').isInt({ min: -1, max: 1 }).withMessage('Invalid vote value'),
    body('userId').notEmpty().withMessage('Missing user ID'),
    body('token').isString().isLength({ min: SECURITY.TOKEN.MIN_LENGTH }).withMessage('Invalid token'),
    body('timestamp').isInt().withMessage('Invalid timestamp'),
    body('nonce').isString().isLength({ min: 32 }).withMessage('Invalid or missing nonce')
];

const handleValidationErrors = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ 
            error: 'Validation failed', 
            details: errors.array() 
        });
    }
    next();
};

// Rate limiters
const limiterOptions = {
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.path === '/healthz',
    keyGenerator: (req) => {
        const realIP = req.headers['x-forwarded-for']?.split(',')[0] || req.ip;
        return realIP;
    }
};

const globalLimiter = rateLimit({
    ...limiterOptions,
    windowMs: SECURITY.RATE_LIMITS.GLOBAL.WINDOW_MS,
    max: SECURITY.RATE_LIMITS.GLOBAL.MAX_REQUESTS,
    message: { error: 'Too many requests from this IP. Try again later.' }
});

const submitLimiter = rateLimit({
    ...limiterOptions,
    windowMs: SECURITY.RATE_LIMITS.SUBMISSION.WINDOW_MS,
    max: SECURITY.RATE_LIMITS.SUBMISSION.MAX_REQUESTS,
    message: { error: 'Too many submissions. Try again later.' }
});

const voteLimiter = rateLimit({
    ...limiterOptions,
    windowMs: SECURITY.RATE_LIMITS.VOTING.WINDOW_MS,
    max: SECURITY.RATE_LIMITS.VOTING.MAX_REQUESTS,
    message: { error: 'Too many votes. Please wait before voting again.' }
});

// Authentication middleware
const authenticate = (req, res, next) => {
    const userId = req.headers['x-user-id'];
    const token = req.headers['x-user-token'];
    const timestamp = req.headers['x-token-timestamp'];
    const nonce = req.headers['x-token-nonce'];

    if (!userId || !token || !timestamp || !nonce || !verifyUserToken(userId, token, timestamp, nonce)) {
        return res.status(401).json({ error: 'Invalid or expired user token' });
    }
    
    req.user = { id: userId };
    next();
};

module.exports = {
    cleanInput,
    validateSegmentInput,
    validateVoteInput,
    validateGetSegments,
    handleValidationErrors,
    globalLimiter,
    submitLimiter,
    voteLimiter,
    authenticate
};
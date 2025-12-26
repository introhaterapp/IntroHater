/**
 * Input Validation Middleware
 * Provides comprehensive input validation and sanitization
 */

const { body, param, query, validationResult } = require('express-validator');
const { AppError } = require('./errorHandler');
const xss = require('xss');

// Validation error handler
function handleValidationErrors(req, res, next) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        const errorMessages = errors.array().map(err => err.msg).join(', ');
        return next(new AppError(`Validation Error: ${errorMessages}`, 400));
    }
    next();
}

// URL validation with SSRF protection
function isSecureUrl(url) {
    try {
        const parsed = new URL(url);
        const host = parsed.hostname.toLowerCase();

        // Block localhost and loopback
        if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '::1') {
            return false;
        }

        // Block private IP ranges
        if (host.match(/^10\./) || 
            host.match(/^192\.168\./) || 
            host.match(/^172\.(1[6-9]|2[0-9]|3[0-1])\./)) {
            return false;
        }

        // Block metadata services
        if (host === '169.254.169.254' || host === 'metadata.google.internal') {
            return false;
        }

        // Only allow HTTP/HTTPS
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            return false;
        }

        return true;
    } catch (e) {
        return false;
    }
}

// Custom validators
const validators = {
    // RD Key validation
    rdKey: () => body('rdKey')
        .exists().withMessage('RD Key is required')
        .isString().withMessage('RD Key must be a string')
        .trim()
        .isLength({ min: 10, max: 200 }).withMessage('RD Key length invalid'),

    // Video ID validation (IMDb format or IMDb:season:episode)
    videoId: (field = 'videoId') => body(field)
        .exists().withMessage(`${field} is required`)
        .isString().withMessage(`${field} must be a string`)
        .trim()
        .matches(/^tt\d{7,8}(:\d+:\d+)?$/).withMessage(`${field} must be valid IMDb ID format`),

    // IMDb ID validation
    imdbId: () => body('imdbID')
        .exists().withMessage('IMDb ID is required')
        .isString().withMessage('IMDb ID must be a string')
        .trim()
        .matches(/^tt\d{7,8}$/).withMessage('IMDb ID must be valid format (tt followed by 7-8 digits)'),

    // Time validation (seconds)
    time: (field) => body(field)
        .exists().withMessage(`${field} is required`)
        .isFloat({ min: 0, max: 18000 }).withMessage(`${field} must be between 0 and 18000 seconds (5 hours)`),

    // Segment label validation
    label: () => body('label')
        .optional()
        .isString().withMessage('Label must be a string')
        .trim()
        .isIn(['Intro', 'Outro', 'Recap', 'Credits', 'Preview', 'Mixed-Intro'])
        .withMessage('Label must be one of: Intro, Outro, Recap, Credits, Preview, Mixed-Intro'),

    // Season/Episode validation
    season: () => body('season')
        .optional()
        .isInt({ min: 0, max: 99 }).withMessage('Season must be between 0 and 99'),

    episode: () => body('episode')
        .optional()
        .isInt({ min: 0, max: 999 }).withMessage('Episode must be between 0 and 999'),

    // Stream URL validation (with SSRF protection)
    streamUrl: () => query('stream')
        .exists().withMessage('Stream URL is required')
        .custom((value) => {
            try {
                const decoded = decodeURIComponent(value);
                if (!isSecureUrl(decoded)) {
                    throw new Error('Invalid or unsafe stream URL');
                }
                return true;
            } catch (e) {
                throw new Error('Invalid stream URL');
            }
        }),

    // Password validation
    password: () => body('password')
        .exists().withMessage('Password is required')
        .isString().withMessage('Password must be a string')
        .isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),

    // Search query validation
    searchQuery: () => query('q')
        .exists().withMessage('Search query is required')
        .isString().withMessage('Query must be a string')
        .trim()
        .isLength({ min: 1, max: 200 }).withMessage('Query must be 1-200 characters')
        .customSanitizer(value => xss(value)),

    // Pagination validation
    pagination: () => [
        query('page').optional().isInt({ min: 1 }).withMessage('Page must be >= 1'),
        query('perPage').optional().isInt({ min: 1, max: 100 }).withMessage('Per page must be 1-100')
    ],

    // Admin action validation
    adminAction: () => body('action')
        .exists().withMessage('Action is required')
        .isIn(['approve', 'reject', 'delete']).withMessage('Action must be approve, reject, or delete')
};

// Sanitize request body to prevent XSS
function sanitizeBody(req, res, next) {
    if (req.body && typeof req.body === 'object') {
        Object.keys(req.body).forEach(key => {
            if (typeof req.body[key] === 'string') {
                req.body[key] = xss(req.body[key]);
            }
        });
    }
    next();
}

module.exports = {
    validators,
    handleValidationErrors,
    sanitizeBody,
    isSecureUrl
};

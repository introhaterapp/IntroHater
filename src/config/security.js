/**
 * Enhanced Security Configuration
 * Provides comprehensive security middleware setup
 */

const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const hpp = require('hpp');

// Enhanced Helmet configuration
const helmetConfig = helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: [
                "'self'",
                // TODO: Remove 'unsafe-inline' - Move inline scripts to external files
                // or use nonces/hashes for better XSS protection
                "'unsafe-inline'", // Required for some inline scripts in docs
                "https://code.jquery.com",
                "https://cdn.datatables.net",
                "https://static.cloudflareinsights.com",
                "https://cdn.jsdelivr.net"
            ],
            styleSrc: [
                "'self'",
                "'unsafe-inline'", // Required for inline styles
                "https://cdn.datatables.net",
                "https://fonts.googleapis.com"
            ],
            fontSrc: [
                "'self'",
                "https://fonts.gstatic.com"
            ],
            imgSrc: [
                "'self'",
                "data:",
                "https://cdn.datatables.net",
                "https://m.media-amazon.com",
                "https://v3-cinemeta.strem.io",
                "https://img.shields.io" // For badges
            ],
            connectSrc: ["'self'"],
            frameSrc: ["'none'"], // Prevent clickjacking
            objectSrc: ["'none'"],
            upgradeInsecureRequests: []
        }
    },
    // Additional security headers
    hsts: {
        maxAge: 31536000, // 1 year
        includeSubDomains: true,
        preload: true
    },
    frameguard: {
        action: 'deny' // X-Frame-Options: DENY
    },
    noSniff: true, // X-Content-Type-Options: nosniff
    xssFilter: true, // X-XSS-Protection: 1; mode=block
    referrerPolicy: {
        policy: 'strict-origin-when-cross-origin'
    }
});

// Rate limiting configurations
const rateLimiters = {
    // Global API rate limiter (more restrictive than current)
    global: rateLimit({
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 1000, // Reduced from 5000
        message: { error: 'Too many requests, please try again later.' },
        standardHeaders: true,
        legacyHeaders: false
    }),

    // Strict limiter for authentication/submission endpoints
    strict: rateLimit({
        windowMs: 60 * 60 * 1000, // 1 hour
        max: 10,
        message: { error: 'Too many attempts, please try again later.' },
        standardHeaders: true,
        legacyHeaders: false
    }),

    // Admin endpoints (very strict)
    admin: rateLimit({
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 20,
        message: { error: 'Too many admin requests, please try again later.' },
        standardHeaders: true,
        legacyHeaders: false
    }),

    // Search endpoint (prevent scraping)
    search: rateLimit({
        windowMs: 60 * 1000, // 1 minute
        max: 30,
        message: { error: 'Too many search requests, please slow down.' },
        standardHeaders: true,
        legacyHeaders: false
    })
};

// CORS configuration (more restrictive)
const corsConfig = {
    origin: function (origin, callback) {
        // In production, require origin validation
        if (process.env.NODE_ENV === 'production') {
            // Allow requests with no origin only if explicitly enabled
            // This is needed for mobile apps, but can be a security risk
            if (!origin && process.env.ALLOW_NO_ORIGIN !== 'true') {
                return callback(new Error('Origin header required'));
            }
            
            if (!origin) return callback(null, true);
            
            const allowedOrigins = [
                process.env.BASE_URL,
                'https://introhater.com',
                'https://www.introhater.com'
            ].filter(Boolean);
            
            if (allowedOrigins.includes(origin)) {
                callback(null, true);
            } else {
                callback(new Error('Not allowed by CORS'));
            }
        } else {
            // In development, allow all (including no origin)
            callback(null, true);
        }
    },
    credentials: true,
    optionsSuccessStatus: 200
};

// HPP configuration (prevent parameter pollution)
const hppConfig = hpp({
    whitelist: ['start', 'end', 'page', 'perPage'] // Allow duplicate parameters for these
});

module.exports = {
    helmetConfig,
    rateLimiters,
    corsConfig,
    hppConfig
};

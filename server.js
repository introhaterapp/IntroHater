/**
 * IntroHater Server
 * 
 * This is the main entry point for the application.
 * All route handlers have been modularized into separate files.
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const hpp = require('hpp');
const morgan = require('morgan');

const rateLimit = require('express-rate-limit');
const log = require('./src/utils/logger').server;

// Configuration
const { SECURITY, SERVER, validateEnv } = require('./src/config/constants');

// Configure ffmpeg/ffprobe paths
const ffmpeg = require('fluent-ffmpeg');
if (process.platform === 'win32') {
    try {
        const ffmpegPath = require('ffmpeg-static');
        const ffprobePath = require('ffprobe-static').path;
        ffmpeg.setFfmpegPath(ffmpegPath);
        ffmpeg.setFfprobePath(ffprobePath);
    } catch { log.info("Using system ffmpeg"); }
} else {
    ffmpeg.setFfmpegPath('ffmpeg');
    ffmpeg.setFfprobePath('ffprobe');
}

// Services
const indexerService = require('./src/services/indexer');

// Route Modules
const apiRoutes = require('./src/routes/api');
const hlsRoutes = require('./src/routes/hls');
const addonRoutes = require('./src/routes/addon');

// ==================== Express App Setup ====================

const app = express();
const PORT = SERVER.PORT;
const PUBLIC_URL = SERVER.PUBLIC_URL || `http://127.0.0.1:${PORT}`;

// Trust proxy for rate limiting behind reverse proxies
app.set('trust proxy', 1);

// Request logging (Critical Priority Rank 1)
app.use(morgan(':remote-addr :method :url :status :response-time ms - :res[content-length]'));

// Security middleware with CSP enabled
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://cdn.datatables.net", "https://code.jquery.com"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdn.datatables.net"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'", "https://www.omdbapi.com", "wss:", "ws:"],
            frameSrc: ["'none'"],
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
            formAction: ["'self'"],
            upgradeInsecureRequests: [],
        }
    },
    crossOriginEmbedderPolicy: false, // Needed for external resources
}));
app.use(hpp());
app.use(cors());
app.use(express.json());

// Global Rate Limiter
const globalLimiter = rateLimit({
    windowMs: SECURITY.RATE_LIMITS.GLOBAL.WINDOW_MS,
    max: SECURITY.RATE_LIMITS.GLOBAL.MAX_REQUESTS,
    message: { error: "Too many requests, please try again later." }
});
app.use('/api/', globalLimiter);

// ==================== Static Files ====================

// Serve Website (Docs)
app.use(express.static(path.join(__dirname, 'docs')));

// ==================== Mount Route Modules ====================

// API routes with versioning
// v1 routes (preferred for new clients)
app.use('/api/v1', apiRoutes);
// Backward compatibility: keep /api working for existing clients
app.use('/api', apiRoutes);

// HLS routes (/hls/*, /vote/*, /sub/*)
app.use('/', hlsRoutes);

// Stremio Addon routes (/manifest.json, /stream/*, /configure)
app.use('/', addonRoutes);

// ==================== Misc Routes ====================

// Auth Mock
app.get('/me', (req, res) => res.json(null));

// Health Check
app.get('/ping', (req, res) => res.send('pong'));

// Global Error Handler (must be after all routes)
const { errorHandler, setupGlobalErrorHandlers } = require('./src/middleware/errorHandler');
setupGlobalErrorHandlers();
app.use(errorHandler);

// 404 Handler (Last Route - after error handler)
app.use((req, res) => {
    res.status(404).json({ success: false, error: "Route not found", path: req.path });
});

// ==================== Server Startup ====================

// Graceful Shutdown
const mongoService = require('./src/services/mongodb');

function gracefulShutdown(signal, server) {
    log.info({ signal }, 'Received shutdown signal. Shutting down gracefully...');

    server.close(async () => {
        log.info('HTTP server closed');

        try {
            await mongoService.close();
            log.info('MongoDB connection closed');
        } catch (e) {
            log.error({ err: e.message }, 'Error closing MongoDB');
        }

        log.info('Goodbye!');
        process.exit(0);
    });

    // Force exit after 10s if connections don't close
    setTimeout(() => {
        log.error('Force shutdown after timeout');
        process.exit(1);
    }, 10000);
}

if (require.main === module) {
    // Validate environment variables on startup (Critical Priority Rank 3)
    validateEnv();

    // Start Indexer
    try {
        indexerService.start();
    } catch (e) { log.error({ err: e }, 'Failed to start indexer'); }

    const server = app.listen(PORT, () => {
        log.info({ port: PORT, publicUrl: PUBLIC_URL }, 'IntroHater Lite running');
    });

    // Register Shutdown Handlers
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM', server));
    process.on('SIGINT', () => gracefulShutdown('SIGINT', server));
}

module.exports = app;

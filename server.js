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
const rateLimit = require('express-rate-limit');

// Configuration
const { SECURITY, SERVER } = require('./src/config/constants');

// Configure ffmpeg/ffprobe paths
const ffmpeg = require('fluent-ffmpeg');
if (process.platform === 'win32') {
    try {
        const ffmpegPath = require('ffmpeg-static');
        const ffprobePath = require('ffprobe-static').path;
        ffmpeg.setFfmpegPath(ffmpegPath);
        ffmpeg.setFfprobePath(ffprobePath);
    } catch (e) { console.log("Using system ffmpeg"); }
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

// Security middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://code.jquery.com", "https://cdn.datatables.net", "https://static.cloudflareinsights.com", "https://cdn.jsdelivr.net"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.datatables.net", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            imgSrc: ["'self'", "data:", "https://cdn.datatables.net", "https://m.media-amazon.com", "https://v3-cinemeta.strem.io"],
            connectSrc: ["'self'"],
        },
    },
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

if (require.main === module) {
    // Start Indexer
    try {
        indexerService.start();
    } catch (e) { console.error("Failed to start indexer:", e); }

    app.listen(PORT, () => {
        console.log(`IntroHater Lite running on ${PORT} (${PUBLIC_URL})`);
    });
}

module.exports = app;

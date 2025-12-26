/**
 * Server.js Integration Reference
 * 
 * This file shows how to integrate the new security and error handling middleware
 * into the existing server.js. Copy relevant sections to update server.js.
 * 
 * DO NOT replace server.js with this file - use it as a reference!
 */

// ============================================
// SECTION 1: Add at the top of server.js (after existing requires)
// ============================================

const { errorHandler, notFoundHandler, asyncHandler, AppError } = require('./src/middleware/errorHandler');
const { validators, handleValidationErrors, sanitizeBody, isSecureUrl } = require('./src/middleware/validation');
const { helmetConfig, rateLimiters, corsConfig, hppConfig } = require('./src/config/security');
const logger = require('./src/utils/logger');
const HealthCheck = require('./src/middleware/healthCheck');

// ============================================
// SECTION 2: Replace existing security middleware
// ============================================

// BEFORE (in server.js lines ~152-166):
// app.use(helmet({ ... }));
// app.use(hpp());
// app.use(cors());

// AFTER:
app.use(helmetConfig);
app.use(cors(corsConfig));
app.use(hppConfig);
app.use(express.json());
app.use(sanitizeBody); // XSS protection

// ============================================
// SECTION 3: Update rate limiting (around line ~169-175)
// ============================================

// BEFORE:
// const globalLimiter = rateLimit({ ... });
// app.use('/api/', globalLimiter);

// AFTER:
app.use('/api/', rateLimiters.global);
app.use('/api/submit', rateLimiters.strict);
app.use('/api/admin/*', rateLimiters.admin);
app.use('/api/search', rateLimiters.search);

// ============================================
// SECTION 4: Add health check endpoints (after static files, before API routes)
// ============================================

const healthCheck = new HealthCheck();

// Add database health check
healthCheck.addCheck('database', async () => {
    try {
        const { getDatabase } = require('./src/services/mongodb');
        const db = await getDatabase();
        const result = await db.command({ ping: 1 });
        return { connected: true, ok: result.ok };
    } catch (error) {
        throw new Error(`Database connection failed: ${error.message}`);
    }
});

// Add external API health checks (optional)
healthCheck.addCheck('real-debrid', async () => {
    const axios = require('axios');
    const rdKey = process.env.RPDB_KEY;
    if (!rdKey) return { status: 'not_configured' };
    
    try {
        const res = await axios.get('https://api.real-debrid.com/rest/1.0/user', {
            headers: { 'Authorization': `Bearer ${rdKey}` },
            timeout: 3000
        });
        return { status: 'ok', user: res.data.username };
    } catch (error) {
        throw new Error('Real-Debrid API unavailable');
    }
});

app.get('/health', healthCheck.basicHandler());
app.get('/health/detailed', healthCheck.detailedHandler());

// ============================================
// SECTION 5: Example - Update /api/submit endpoint with validation
// ============================================

// BEFORE (around line ~484):
// app.post('/api/submit', async (req, res) => {
//     const { rdKey, imdbID, season, episode, start, end, label, applyToSeries } = req.body;
//     if (!rdKey || !imdbID || start === undefined || end === undefined) {
//         return res.status(400).json({ error: "Missing required fields" });
//     }
//     ...
// });

// AFTER:
app.post('/api/submit',
    validators.rdKey(),
    validators.imdbId(),
    validators.time('start'),
    validators.time('end'),
    validators.label(),
    validators.season(),
    validators.episode(),
    handleValidationErrors,
    asyncHandler(async (req, res) => {
        const { rdKey, imdbID, season, episode, start, end, label, applyToSeries } = req.body;

        // Verify RD Key
        try {
            const rdCheck = await axios.get('https://api.real-debrid.com/rest/1.0/user', {
                headers: { 'Authorization': `Bearer ${rdKey}` },
                timeout: 3000
            });
            if (!rdCheck.data || !rdCheck.data.id) {
                throw new AppError('Invalid Real-Debrid Key', 401);
            }
        } catch (error) {
            if (error.statusCode) throw error;
            throw new AppError('Invalid Real-Debrid Key. Only active RD users can contribute.', 401);
        }

        const userId = generateUserId(rdKey);

        // Improved ID Construction
        let fullId = imdbID;
        if (season && episode && !imdbID.includes(':')) {
            fullId = `${imdbID}:${season}:${episode}`;
        }

        // Log with structured logger
        if (applyToSeries) {
            logger.info('Global series skip submitted', {
                userId: userId.substr(0, 6),
                imdbId: imdbID,
                start,
                end
            });
        } else {
            logger.info('Skip segment submitted', {
                userId: userId.substr(0, 6),
                videoId: fullId,
                start,
                end,
                label
            });
        }

        const newSeg = await skipService.addSkipSegment(
            fullId,
            parseFloat(start),
            parseFloat(end),
            label || "Intro",
            userId,
            applyToSeries
        );

        // Give user credit
        await userService.updateUserStats(userId, { segments: 1 });

        res.json({ success: true, segment: newSeg });
    })
);

// ============================================
// SECTION 6: Example - Update /api/stats/personal with validation
// ============================================

// BEFORE (around line ~368):
// app.post('/api/stats/personal', async (req, res) => {
//     const { rdKey } = req.body;
//     if (!rdKey) return res.status(400).json({ error: "RD Key required" });
//     ...
// });

// AFTER:
app.post('/api/stats/personal',
    validators.rdKey(),
    handleValidationErrors,
    asyncHandler(async (req, res) => {
        const { rdKey } = req.body;

        // Verify RD Key
        try {
            await axios.get('https://api.real-debrid.com/rest/1.0/user', {
                headers: { 'Authorization': `Bearer ${rdKey}` },
                timeout: 3000
            });
        } catch (error) {
            throw new AppError('Invalid Real-Debrid Key', 401);
        }

        const userId = generateUserId(rdKey);
        const stats = await userService.getUserStats(userId);

        if (!stats) {
            return res.json({
                userId: userId,
                segments: 0,
                votes: 0,
                savedTime: 0,
                rank: "-",
                history: []
            });
        }

        // Calculate rank
        const leaderboard = await userService.getLeaderboard(1000);
        const rank = leaderboard.findIndex(u => u.userId === userId) + 1;

        // Resolve history metadata
        const enrichedHistory = await Promise.all(
            (stats.watchHistory || []).slice(0, 15).map(async (item) => {
                const parts = item.videoId.split(':');
                const imdbId = parts[0];
                const season = parts[1];
                const episode = parts[2];

                let title = imdbId;
                let poster = null;

                if (!global.metadataCache) global.metadataCache = {};

                if (global.metadataCache[imdbId]) {
                    title = global.metadataCache[imdbId].Title;
                    poster = global.metadataCache[imdbId].Poster !== "N/A"
                        ? global.metadataCache[imdbId].Poster
                        : null;
                } else {
                    try {
                        const data = await catalogService.fetchMetadata(imdbId);
                        if (data) {
                            title = data.Title;
                            poster = data.Poster;
                            global.metadataCache[imdbId] = data;
                        }
                    } catch (e) {
                        logger.warn('Failed to fetch metadata', { imdbId, error: e.message });
                    }
                }

                return {
                    ...item,
                    title: season && episode ? `${title} S${season}E${episode}` : title,
                    poster: poster
                };
            })
        );

        res.json({
            ...stats,
            userId: userId,
            savedTime: stats.savedTime || 0,
            rank: rank > 0 ? rank : "-",
            history: enrichedHistory
        });
    })
);

// ============================================
// SECTION 7: Example - Update HLS manifest endpoint with better URL validation
// ============================================

// BEFORE (around line ~775):
// app.get('/hls/manifest.m3u8', async (req, res) => {
//     const { stream, ... } = req.query;
//     if (!stream || !isSafeUrl(decodeURIComponent(stream))) {
//         return res.status(400).send("Invalid or unsafe stream URL");
//     }
//     ...
// });

// AFTER:
app.get('/hls/manifest.m3u8',
    validators.streamUrl(),
    handleValidationErrors,
    asyncHandler(async (req, res) => {
        const { stream, start: startStr, end: endStr, id: videoId, user: userId, rdKey } = req.query;

        // Authenticated telemetry
        if (videoId && userId && rdKey) {
            const telemetryKey = `${userId}:${videoId}`;
            if (!global.loggedHistory?.[telemetryKey]) {
                try {
                    await axios.get('https://api.real-debrid.com/rest/1.0/user', {
                        headers: { 'Authorization': `Bearer ${rdKey}` },
                        timeout: 2000
                    });

                    if (!global.loggedHistory) global.loggedHistory = {};
                    global.loggedHistory[telemetryKey] = Date.now();

                    logger.info('Play logged', {
                        userId: userId.substr(0, 6),
                        videoId
                    });

                    userService.addWatchHistory(userId, {
                        videoId: videoId,
                        skip: { start: parseFloat(startStr), end: parseFloat(endStr) }
                    });

                    userService.updateUserStats(userId, {
                        votes: 1,
                        videoId: videoId
                    });
                } catch (error) {
                    logger.warn('Telemetry auth failed', {
                        userId: userId.substr(0, 6),
                        error: error.message
                    });
                }

                // GC old history logs
                if (global.loggedHistory && Object.keys(global.loggedHistory).length > 2000) {
                    const cutoff = Date.now() - 3600000;
                    for (const k in global.loggedHistory) {
                        if (global.loggedHistory[k] < cutoff) delete global.loggedHistory[k];
                    }
                }
            }
        }

        let streamUrl = decodeURIComponent(stream);
        const introStart = parseFloat(startStr) || 0;
        const introEnd = parseFloat(endStr) || 0;

        // Cache Key
        const cacheKey = `${streamUrl}_${introStart}_${introEnd}`;
        if (manifestCache.has(cacheKey)) {
            res.set('Content-Type', 'application/vnd.apple.mpegurl');
            return res.send(manifestCache.get(cacheKey));
        }

        logger.debug('Generating HLS manifest', { introStart, introEnd });

        // ... rest of the existing logic ...
        
        // On error, log properly
        try {
            // existing manifest generation logic
        } catch (error) {
            logger.error('HLS Proxy Error', {
                error: error.message,
                stack: error.stack,
                streamUrl: streamUrl.slice(-50)
            });
            res.redirect(stream);
        }
    })
);

// ============================================
// SECTION 8: Replace console.log with logger throughout
// ============================================

// Find and replace patterns:
// console.log("... → logger.info("...
// console.log(\`... → logger.info(\`...
// console.error("... → logger.error("...
// console.warn("... → logger.warn("...

// Example replacements:
// BEFORE: console.log(`[Server] Request for ${type} ${id}`);
// AFTER:  logger.info('Stream request', { type, id });

// BEFORE: console.error("[Server] No RD Key provided.");
// AFTER:  logger.error('No RD Key provided');

// BEFORE: console.log(`[HLS] Generating manifest for Intro: ${introStart}s - ${introEnd}s`);
// AFTER:  logger.info('Generating HLS manifest', { introStart, introEnd });

// ============================================
// SECTION 9: Add error handling at the END of server.js (before listen)
// ============================================

// Replace existing 404 handler (around line ~982-985):
// app.use((req, res) => {
//     res.status(404).json({ error: "IntroHater Lite: Route not found", path: req.path });
// });

// WITH:
app.use(notFoundHandler);
app.use(errorHandler);

// ============================================
// SECTION 10: Update server startup logging
// ============================================

// BEFORE:
// app.listen(PORT, () => {
//     console.log(`IntroHater Lite running on ${PORT} (${PUBLIC_URL})`);
// });

// AFTER:
app.listen(PORT, () => {
    logger.info('IntroHater server started', {
        port: PORT,
        publicUrl: PUBLIC_URL,
        environment: process.env.NODE_ENV || 'development',
        nodeVersion: process.version
    });
});

// ============================================
// SECTION 11: Add graceful shutdown
// ============================================

process.on('SIGTERM', () => {
    logger.info('SIGTERM received, shutting down gracefully');
    server.close(() => {
        logger.info('Server closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    logger.info('SIGINT received, shutting down gracefully');
    server.close(() => {
        logger.info('Server closed');
        process.exit(0);
    });
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Promise Rejection', {
        reason: reason,
        promise: promise
    });
});

process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception', {
        error: error.message,
        stack: error.stack
    });
    process.exit(1);
});

/**
 * MIGRATION CHECKLIST
 * 
 * [ ] 1. Add new requires at top of server.js
 * [ ] 2. Replace helmet/cors/hpp configuration
 * [ ] 3. Update rate limiting
 * [ ] 4. Add health check endpoints
 * [ ] 5. Add validation to /api/submit
 * [ ] 6. Add validation to /api/stats/personal
 * [ ] 7. Add validation to /api/report
 * [ ] 8. Add validation to /hls/manifest.m3u8
 * [ ] 9. Replace console.log with logger
 * [ ] 10. Add error handling middleware at end
 * [ ] 11. Update server startup
 * [ ] 12. Add graceful shutdown handlers
 * [ ] 13. Test all endpoints
 * [ ] 14. Monitor logs and health checks
 */

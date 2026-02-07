const express = require('express');
const router = express.Router();
const skipService = require('../services/skip-service');
const { apiKeyAuth, createRateLimiter, requirePermission } = require('../middleware/apiAuth');
const log = require('../utils/logger').api;

/**
 * @swagger
 * components:
 *   securitySchemes:
 *     ApiKeyAuth:
 *       type: apiKey
 *       in: header
 *       name: x-api-key
 */

// Rate limiting for public API
const apiLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each key to 100 requests per window
    message: { error: "Too many requests, please try again later." }
});

// Apply API key authentication and rate limiting to all v1 routes
router.use(apiKeyAuth);
router.use(apiLimiter);

/**
 * @swagger
 * /api/v1/segments/{videoId}:
 *   get:
 *     summary: Get skip segments for a video
 *     tags: [Segments]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: videoId
 *         required: true
 *         schema:
 *           type: string
 *         description: The IMDB ID or Kitsu ID of the video
 *     responses:
 *       200:
 *         description: A list of skip segments
 *       401:
 *         description: Unauthorized
 */
router.get('/segments/:videoId', requirePermission('read:segments'), async (req, res) => {
    try {
        const { videoId } = req.params;
        const segments = await skipService.getSegments(videoId);
        res.json(segments);
    } catch (error) {
        log.error({ err: error, videoId: req.params.videoId }, "Error fetching segments in v1 API");
        res.status(500).json({ error: "Failed to retrieve segments" });
    }
});

/**
 * @swagger
 * /api/v1/segments:
 *   post:
 *     summary: Submit a new skip segment
 *     tags: [Segments]
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [videoId, start, end]
 *             properties:
 *               videoId:
 *                 type: string
 *               start:
 *                 type: number
 *               end:
 *                 type: number
 *               label:
 *                 type: string
 *                 default: Intro
 *     responses:
 *       201:
 *         description: Segment submitted successfully
 *       400:
 *         description: Invalid input
 *       403:
 *         description: Insufficient permissions
 */
router.post('/segments', requirePermission('write:segments'), async (req, res) => {
    try {
        const { videoId, start, end, label } = req.body;

        if (!videoId || typeof start !== 'number' || typeof end !== 'number') {
            return res.status(400).json({ error: "Missing required fields: videoId, start, end" });
        }

        if (start < 0 || end <= start) {
            return res.status(400).json({ error: "Invalid segment times" });
        }

        const userId = req.apiKey?.userId || req.apiKey?.name || 'api_user';
        const segment = await skipService.addSkipSegment(videoId, start, end, label || 'Intro', userId);

        if (segment) {
            res.status(201).json({ message: "Segment submitted successfully", segment });
        } else {
            res.status(409).json({ message: "Duplicate or invalid segment" });
        }
    } catch (error) {
        log.error({ err: error, body: req.body }, "Error submitting segment in v1 API");
        res.status(500).json({ error: "Failed to submit segment" });
    }
});

/**
 * @swagger
 * /api/v1/stats:
 *   get:
 *     summary: Get global statistics
 *     tags: [Stats]
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Global statistics
 */
router.get('/stats', requirePermission('read:stats'), async (req, res) => {
    try {
        const count = await skipService.getSegmentCount();
        res.json({ totalSegments: count });
    } catch (error) {
        log.error({ err: error }, "Error fetching stats in v1 API");
        res.status(500).json({ error: "Failed to retrieve statistics" });
    }
});

module.exports = router;

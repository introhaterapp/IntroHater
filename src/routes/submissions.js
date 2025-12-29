

const express = require('express');
const router = express.Router();
const axios = require('axios');

const skipService = require('../services/skip-service');
const userService = require('../services/user-service');
const { requireDebridAuth: requireRdAuth } = require('../middleware/debridAuth');
const { generateUserToken, verifyUserToken } = require('../utils/auth');


router.post('/report', requireRdAuth, async (req, res) => {
    const { videoId, reason, segmentIndex } = req.body;
    if (!videoId) return res.status(400).json({ success: false, error: "Video ID required" });

    const userId = req.userId;
    console.log(`[Report] User ${userId.substr(0, 6)} reported ${videoId} (Seg: ${segmentIndex}): ${reason || 'No reason'}`);

    await skipService.reportSegment(videoId, segmentIndex || 0);
    await userService.updateUserStats(userId, { votes: -1, videoId: videoId });

    res.json({ success: true, message: "Issue reported. Thank you!" });
});


router.post('/submit', requireRdAuth, async (req, res) => {
    const { imdbID, season, episode, start, end, label, applyToSeries } = req.body;
    if (!imdbID || start === undefined || end === undefined) {
        return res.status(400).json({ success: false, error: "Missing required fields" });
    }

    const userId = req.userId;

    let fullId = imdbID;
    if (season && episode && !imdbID.includes(':')) {
        fullId = `${imdbID}:${season}:${episode}`;
    }

    if (applyToSeries) {
        console.log(`[Submit] User ${userId.substr(0, 6)} submitted GLOBAL SERIES SKIP ${start}-${end}s for ${imdbID}`);
    } else {
        console.log(`[Submit] User ${userId.substr(0, 6)} submitted ${start}-${end}s for ${fullId}`);
    }

    const newSeg = await skipService.addSkipSegment(fullId, parseFloat(start), parseFloat(end), label || "Intro", userId, applyToSeries);
    await userService.updateUserStats(userId, { segments: 1 });

    res.json({ success: true, segment: newSeg });
});


router.post('/generate-token', async (req, res) => {
    const { userId, rdKey } = req.body;
    const apiKey = req.headers['x-api-key'];

    if (apiKey !== process.env.API_KEY && !rdKey) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    if (rdKey) {
        try {
            await axios.get('https://api.real-debrid.com/rest/1.0/user', {
                headers: { 'Authorization': `Bearer ${rdKey}` },
                timeout: 5000
            });
        } catch {
            return res.status(401).json({ error: "Invalid RD Key" });
        }
    }

    const tokenData = generateUserToken(userId);
    await userService.storeUserToken(userId, tokenData.token, tokenData.timestamp, tokenData.nonce);
    res.json(tokenData);
});


router.post('/track/skip', async (req, res) => {
    const { userId, token, duration } = req.body;

    if (!userId || !token || !duration) {
        return res.status(400).json({ error: "Missing required fields" });
    }

    const isValid = await verifyUserToken(userId, token);
    if (!isValid) {
        return res.status(401).json({ error: "Invalid or expired token" });
    }

    await userService.incrementSavedTime(userId, parseFloat(duration));
    res.json({ success: true });
});

module.exports = router;

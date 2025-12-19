const express = require('express');
const path = require('path');

const router = express.Router();

// Health check endpoint
router.get('/api/healthz', (req, res) => {
    res.status(200).json({ status: 'healthy' });
});

// Static assets - these are now handled by express.static in server.js
// Keeping these as fallbacks
router.get('/favicon.ico', (req, res) => {
    res.sendFile(path.join(__dirname, '../../docs/favicon.ico'));
});

router.get('/icon32.png', (req, res) => {
    res.sendFile(path.join(__dirname, '../../IntroHaterExtension/icon32.png'));
});

router.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../../docs/index.html'));
});

module.exports = router;
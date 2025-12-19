const express = require('express');
const router = express.Router();
const apiKeyService = require('../services/apiKey');

// Middleware to ensure user is authenticated
const requireAuth = (req, res, next) => {
    if (!req.oidc || !req.oidc.isAuthenticated()) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    next();
};

// Middleware to check if user is an admin
const requireAdmin = (req, res, next) => {
    // Check admin emails
    const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(email => email.trim());
    
    // Check admin GitHub IDs
    const adminGithubIds = (process.env.ADMIN_GITHUB_IDS || '').split(',').map(id => id.trim());
    const githubId = req.oidc?.user?.sub?.split('|')[1];
    
    // User must be authenticated and either have an admin email or GitHub ID
    if (!req.oidc || !req.oidc.isAuthenticated() || 
        !req.oidc.user || 
        !(adminEmails.includes(req.oidc.user.email) || adminGithubIds.includes(githubId))) {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
};

// Apply auth check to all routes in this router
router.use(requireAuth);

// Get all API keys for the authenticated user
router.get('/', async (req, res) => {
    try {
        const userId = req.oidc.user.sub;
        const keys = await apiKeyService.getKeysByUser(userId);
        
        const sanitizedKeys = keys.map(key => ({
            id: key._id,
            name: key.name,
            permissions: key.permissions,
            createdAt: key.createdAt,
            lastUsed: key.lastUsed,
            isActive: key.isActive,
            partialKey: `${key.key.substring(0, 4)}...${key.key.substring(key.key.length - 4)}`
        }));
        
        res.json({ keys: sanitizedKeys });
    } catch (error) {
        console.error('Error retrieving API keys:', error);
        res.status(500).json({ error: 'Failed to retrieve API keys' });
    }
});

// Generate a new API key
router.post('/', async (req, res) => {
    try {
        const { name, permissions } = req.body;
        if (!name) {
            return res.status(400).json({ error: 'API key name is required' });
        }

        const userId = req.oidc.user.sub;
        const apiKey = await apiKeyService.generateApiKey(
            userId,
            name,
            permissions || ['read:segments']
        );

        res.status(201).json({
            message: 'API key created successfully',
            apiKey: {
                id: apiKey._id,
                name: apiKey.name,
                key: apiKey.key,
                permissions: apiKey.permissions,
                createdAt: apiKey.createdAt
            }
        });
    } catch (error) {
        console.error('Error generating API key:', error);
        res.status(500).json({ error: 'Failed to generate API key' });
    }
});

// Revoke an API key
router.delete('/:id', async (req, res) => {
    try {
        const userId = req.oidc.user.sub;
        const keyId = req.params.id;
        
        // First get the key to verify ownership
        const keys = await apiKeyService.getKeysByUser(userId);
        const keyBelongsToUser = keys.some(key => key._id.toString() === keyId);
        
        if (!keyBelongsToUser) {
            return res.status(403).json({ error: 'You do not have permission to revoke this API key' });
        }
        
        const revoked = await apiKeyService.revokeKey(keyId);
        if (revoked) {
            res.json({ message: 'API key revoked successfully' });
        } else {
            res.status(404).json({ error: 'API key not found' });
        }
    } catch (error) {
        console.error('Error revoking API key:', error);
        res.status(500).json({ error: 'Failed to revoke API key' });
    }
});

// ADMIN ENDPOINTS

// Get all API keys (admin only)
router.get('/admin/all', requireAdmin, async (req, res) => {
    try {
        const keys = await apiKeyService.getKeysWithUserInfo();
        // Return in the format expected by admin-keys.html
        res.json({ 
            keys: keys.map(key => ({
                ...key,
                _id: key._id, // Ensure _id is included for revoke functionality
                userName: key.userName || key.userEmail || key.userId,
                lastUsed: key.lastUsed || null
            }))
        });
    } catch (error) {
        console.error('Error retrieving all API keys:', error);
        res.status(500).json({ error: 'Failed to retrieve API keys' });
    }
});

// Get usage stats for all keys (admin only)
router.get('/admin/usage', requireAdmin, async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        const stats = await apiKeyService.getUsageForAllKeys(startDate, endDate);
        res.json({ stats });
    } catch (error) {
        console.error('Error retrieving API usage stats:', error);
        res.status(500).json({ error: 'Failed to retrieve API usage statistics' });
    }
});

// Admin revoke any key
router.delete('/admin/:id', requireAdmin, async (req, res) => {
    try {
        const keyId = req.params.id;
        const revoked = await apiKeyService.revokeKey(keyId);
        
        if (revoked) {
            res.json({ message: 'API key revoked successfully' });
        } else {
            res.status(404).json({ error: 'API key not found' });
        }
    } catch (error) {
        console.error('Error revoking API key:', error);
        res.status(500).json({ error: 'Failed to revoke API key' });
    }
});

module.exports = router;
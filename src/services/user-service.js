const userRepository = require('../repositories/user.repository');

// Initialize
let initPromise = null;

async function ensureInit() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
        try {
            console.log('[Users] Initializing Database-Only User Service...');
            await userRepository.ensureInit();
        } catch (e) {
            console.error("[Users] Init Error:", e);
        }
    })();
    return initPromise;
}

// Trigger early
ensureInit();

// --- Stats Operations ---

async function getUserStats(userId) {
    await ensureInit();
    return await userRepository.findByUserId(userId);
}

async function addWatchHistory(userId, item) {
    await ensureInit();
    let stats = await getUserStats(userId);
    if (!stats) {
        stats = { userId, segments: 0, votes: 0, votedVideos: [], watchHistory: [], lastUpdated: new Date().toISOString() };
    }

    if (!stats.watchHistory) stats.watchHistory = [];

    // Add to history (limit to last 50 items)
    const existingIndex = stats.watchHistory.findIndex(h => h.videoId === item.videoId);
    if (existingIndex > -1) {
        stats.watchHistory.splice(existingIndex, 1);
    }

    stats.watchHistory.unshift({
        ...item,
        timestamp: new Date().toISOString()
    });

    if (stats.watchHistory.length > 50) {
        stats.watchHistory = stats.watchHistory.slice(0, 50);
    }

    // Calculate skip duration if provided
    if (item.skip && item.skip.end > item.skip.start) {
        const saved = item.skip.end - item.skip.start;
        await incrementSavedTime(userId, saved);
    }

    return await updateUserStats(userId, { watchHistory: stats.watchHistory });
}

async function updateUserStats(userId, updates) {
    await ensureInit();

    try {
        // Handle Atomic Vote Updates
        if (updates.votes && updates.videoId) {
            const videoId = updates.videoId;
            const voteVal = updates.votes;

            await userRepository.updateOne(
                { userId, votedVideos: { $ne: videoId } },
                {
                    $inc: { votes: voteVal },
                    $addToSet: { votedVideos: videoId },
                    $set: { lastUpdated: new Date().toISOString() }
                },
                { upsert: false }
            );

            // Double check user exists if not updated above (likely already voted or new user)
            const exists = await userRepository.findByUserId(userId);
            if (!exists) {
                await userRepository.updateOne(
                    { userId },
                    {
                        $setOnInsert: { userId, segments: 0, votes: voteVal, votedVideos: [videoId] },
                        $set: { lastUpdated: new Date().toISOString() }
                    },
                    { upsert: true }
                );
            }
            delete updates.votes;
            delete updates.videoId;
        }

        // Handle Atomic Increments (savedTime)
        if (updates.savedTime && updates.isIncrement) {
            await userRepository.updateOne(
                { userId },
                {
                    $inc: { savedTime: updates.savedTime },
                    $set: { lastUpdated: new Date().toISOString() }
                },
                { upsert: true }
            );
            delete updates.savedTime;
            delete updates.isIncrement;
        }

        // Handle remaining updates
        if (Object.keys(updates).length > 0) {
            await userRepository.updateOne(
                { userId },
                { $set: { ...updates, lastUpdated: new Date().toISOString() } },
                { upsert: true }
            );
        }
        return await getUserStats(userId);
    } catch (e) {
        console.error("[Users] Update Error:", e.message);
        return null;
    }
}

async function getLeaderboard(limit = 10) {
    await ensureInit();
    return await userRepository.getLeaderboard(limit);
}

async function getStats() {
    await ensureInit();
    const userCount = await userRepository.countDocuments();
    const agg = await userRepository.getStatsAggregation();
    const voteCount = agg[0] ? agg[0].totalVotes : 0;

    const globalStats = await userRepository.findGlobalStats();
    const totalSavedTime = globalStats ? (globalStats.totalSavedTime || 0) : 0;

    return { userCount, voteCount, totalSavedTime };
}

async function incrementSavedTime(userId, duration) {
    if (!duration || duration <= 0) return;
    await ensureInit();

    // 1. Update Global Stats
    await userRepository.incrementGlobalSavedTime(duration);

    // 2. Update User Stats
    if (userId && userId !== 'anonymous' && userId !== 'null') {
        await updateUserStats(userId, { savedTime: duration, isIncrement: true });
    }
}

// --- Token Operations ---

async function getUserToken(userId) {
    await ensureInit();
    return await userRepository.findTokenByUserId(userId);
}

async function storeUserToken(userId, token, timestamp, nonce) {
    await ensureInit();
    let entry = {
        userId,
        token,
        timestamp,
        nonce,
        lastUsed: new Date().toISOString()
    };

    const existing = await userRepository.findTokenByUserId(userId);
    entry.createdAt = existing ? existing.createdAt : new Date().toISOString();
    await userRepository.upsertToken(userId, entry);

    return entry;
}

module.exports = {
    getUserStats,
    updateUserStats,
    addWatchHistory,
    getLeaderboard,
    getStats,
    getUserToken,
    storeUserToken,
    incrementSavedTime
};

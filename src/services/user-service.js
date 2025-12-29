const userRepository = require('../repositories/user.repository');
const log = require('../utils/logger').users;


let initPromise = null;

async function ensureInit() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
        try {
            log.info('Initializing Database-Only User Service...');
            await userRepository.ensureInit();
        } catch (e) {
            log.error({ err: e }, 'Init Error');
        }
    })();
    return initPromise;
}


ensureInit();




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

    
    if (item.skip && item.skip.end > item.skip.start) {
        const saved = item.skip.end - item.skip.start;
        await incrementSavedTime(userId, saved);
    }

    return await updateUserStats(userId, { watchHistory: stats.watchHistory });
}


async function updateUserStats(userId, updates) {
    await ensureInit();

    try {
        
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

        
        if (Object.keys(updates).length > 0) {
            await userRepository.updateOne(
                { userId },
                { $set: { ...updates, lastUpdated: new Date().toISOString() } },
                { upsert: true }
            );
        }
        return await getUserStats(userId);
    } catch (e) {
        log.error({ err: e.message }, 'Update Error');
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

    
    await userRepository.incrementGlobalSavedTime(duration);

    
    if (userId && userId !== 'anonymous' && userId !== 'null') {
        await updateUserStats(userId, { savedTime: duration, isIncrement: true });
    }
}




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

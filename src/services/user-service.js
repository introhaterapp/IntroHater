const fs = require('fs').promises;
const path = require('path');
const userRepository = require('../repositories/user.repository');

const DATA_FILE = path.join(__dirname, '../data/users.json');

// In-memory cache (Fallback)
let usersData = {
    stats: [],
    tokens: [],
    globalStats: {
        totalSavedTime: 0
    }
};

// Initialize
let initPromise = null;

function ensureInit() {
    if (initPromise) return initPromise;

    initPromise = (async () => {
        try {
            console.log('[Users] Initializing...');
            await userRepository.ensureInit();

            if (!userRepository.useMongo) {
                console.log('[Users] Using local JSON for persistence.');
                await loadUsers();
            }
        } catch (e) {
            console.error("[Users] Init Error:", e);
            await loadUsers();
        }
    })();

    return initPromise;
}

// Trigger early - REMOVED for lazy init
// ensureInit();

async function loadUsers() {
    try {
        const data = await fs.readFile(DATA_FILE, 'utf8');
        usersData = JSON.parse(data);
        console.log(`[Users] Loaded ${usersData.stats.length} stats and ${usersData.tokens.length} tokens from file.`);
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log('[Users] No users.json found, starting fresh.');
            await saveUsers();
        } else {
            console.error('[Users] Error loading data:', error);
        }
    }
}

async function saveUsers() {
    try {
        // Ensure directory exists
        const dir = path.dirname(DATA_FILE);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(DATA_FILE, JSON.stringify(usersData, null, 4));
    } catch (error) {
        console.error('[Users] Error saving data:', error);
    }
}

// --- Stats Operations ---

async function getUserStats(userId) {
    await ensureInit();
    if (userRepository.useMongo) {
        return await userRepository.findByUserId(userId);
    }
    return usersData.stats.find(s => s.userId === userId) || null;
}

async function addWatchHistory(userId, item) {
    let stats = await getUserStats(userId);
    if (!stats) {
        stats = { userId, segments: 0, votes: 0, votedVideos: [], watchHistory: [], lastUpdated: new Date().toISOString() };
    }

    if (!stats.watchHistory) stats.watchHistory = [];

    // Add to history (limit to last 50 items)
    // Check if we already have this video recently to avoid spam, but update timestamp
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
            const res = await userRepository.collection.findOneAndUpdate(
                { userId, votedVideos: { $ne: updates.videoId } },
                {
                    $inc: { votes: updates.votes },
                    $addToSet: { votedVideos: updates.videoId },
                    $set: { lastUpdated: new Date().toISOString() }
                },
                { returnDocument: 'after', upsert: false }
            );

            if (res && (res.value || res.lastErrorObject?.updatedExisting)) {
                console.log(`[Users] Atomic vote added for ${userId.substr(0, 8)} on ${updates.videoId}`);
            } else {
                const exists = await userRepository.findByUserId(userId);
                if (!exists) {
                    await userRepository.updateOne(
                        { userId },
                        {
                            $setOnInsert: { userId, segments: 0, votes: updates.votes, votedVideos: [updates.videoId] },
                            $set: { lastUpdated: new Date().toISOString() }
                        },
                        { upsert: true }
                    );
                    console.log(`[Users] New user created with vote: ${userId.substr(0, 8)}`);
                }
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
        console.error("[Users] Repository update failed, falling back:", e.message);

        // --- Local / Fallback logic ---
        let stats = usersData.stats.find(s => s.userId === userId);
        if (!stats) {
            stats = { userId, segments: 0, votes: 0, votedVideos: [], lastUpdated: new Date().toISOString() };
            if (!userRepository.useMongo) usersData.stats.push(stats);
        }

        if (updates.votes && typeof updates.votes === 'number') {
            const videoId = updates.videoId;
            if (!stats.votedVideos) stats.votedVideos = [];
            if (videoId && !stats.votedVideos.includes(videoId)) {
                stats.votes = (stats.votes || 0) + updates.votes;
                stats.votedVideos.push(videoId);
                console.log(`[Users] Vote added for ${userId.substr(0, 6)}... on ${videoId}`);
            }
            delete updates.votes;
            delete updates.videoId;
        }

        if (updates.savedTime && updates.isIncrement) {
            stats.savedTime = (stats.savedTime || 0) + updates.savedTime;
            delete updates.savedTime;
            delete updates.isIncrement;
        }

        Object.assign(stats, updates);
        stats.lastUpdated = new Date().toISOString();

        if (!userRepository.useMongo) await saveUsers();
        return stats;
    }
}

async function getLeaderboard(limit = 10) {
    await ensureInit();
    if (userRepository.useMongo) {
        return await userRepository.getLeaderboard(limit);
    }

    return usersData.stats
        .sort((a, b) => {
            const votesA = a.votes || 0;
            const votesB = b.votes || 0;
            if (votesB !== votesA) return votesB - votesA;
            return (b.segments || 0) - (a.segments || 0);
        })
        .slice(0, limit);
}

async function getStats() {
    await ensureInit();
    if (userRepository.useMongo) {
        const userCount = await userRepository.countDocuments();
        const agg = await userRepository.getStatsAggregation();
        const voteCount = agg[0] ? agg[0].totalVotes : 0;

        const globalStats = await userRepository.findGlobalStats();
        const totalSavedTime = globalStats ? (globalStats.totalSavedTime || 0) : 0;

        return { userCount, voteCount, totalSavedTime };
    }

    const userCount = usersData.stats.length;
    const voteCount = usersData.stats.reduce((sum, user) => sum + (user.votes || 0), 0);
    const totalSavedTime = usersData.globalStats ? (usersData.globalStats.totalSavedTime || 0) : 0;

    return { userCount, voteCount, totalSavedTime };
}

async function incrementSavedTime(userId, duration) {
    if (!duration || duration <= 0) return;
    await ensureInit();

    // 1. Update Global Stats
    if (userRepository.useMongo) {
        await userRepository.incrementGlobalSavedTime(duration);
    } else {
        if (!usersData.globalStats) usersData.globalStats = { totalSavedTime: 0 };
        usersData.globalStats.totalSavedTime = (usersData.globalStats.totalSavedTime || 0) + duration;
    }

    // 2. Update User Stats
    if (userId && userId !== 'anonymous') {
        await updateUserStats(userId, { savedTime: duration, isIncrement: true });
    } else {
        // Just save global if anonymous
        if (!useMongo) await saveUsers();
    }
}

// --- Token Operations ---

async function getUserToken(userId) {
    await ensureInit();
    if (userRepository.useMongo) {
        return await userRepository.findTokenByUserId(userId);
    }
    return usersData.tokens.find(t => t.userId === userId) || null;
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

    if (userRepository.useMongo) {
        const existing = await userRepository.findTokenByUserId(userId);
        entry.createdAt = existing ? existing.createdAt : new Date().toISOString();
        await userRepository.upsertToken(userId, entry);
    } else {
        let tokenEntry = usersData.tokens.find(t => t.userId === userId);
        entry.createdAt = tokenEntry ? tokenEntry.createdAt : new Date().toISOString();

        if (tokenEntry) {
            Object.assign(tokenEntry, entry);
        } else {
            usersData.tokens.push(entry);
        }
        await saveUsers();
    }

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

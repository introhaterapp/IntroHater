// popup.js
// Cross-browser compatibility
const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

// Import dependencies
import { checkAndRenewToken } from './modules/auth.js';
import { API_KEY, API_BASE_URL } from './modules/utils.js';

// Helper functions for consistent storage operations
function storageGet(keys) {
    return new Promise(resolve => {
        browserAPI.storage.sync.get(keys, resolve);
    });
}

function storageSet(data) {
    return new Promise(resolve => {
        browserAPI.storage.sync.set(data, resolve);
    });
}

// Add stats cache at top level
let cachedStats = null;
let cachedToggleState = null;

async function getStremioUserId() {
    try {
        // First check chrome.storage.local
        const localData = await new Promise(resolve => {
            browserAPI.storage.local.get(['_id'], resolve);
        });
        if (localData._id) {
            // Store it in sync storage for consistency
            await storageSet({ userId: localData._id });
            return localData._id;
        }

        // If not in local, check sync storage
        const data = await storageGet(['userId']);
        if (data.userId) {
            return data.userId;
        }

        // If not in storage, get it from content script
        const tabs = await browserAPI.tabs.query({ 
            url: [
                "*://*.strem.io/*",
                "*://*.stremioapps.com/*",
                "*://web.stremio.com/*",
                "*://app.strem.io/*"
            ]
        });
        
        for (const tab of tabs) {
            try {
                const response = await browserAPI.tabs.sendMessage(tab.id, { 
                    type: 'GET_STREMIO_USER_ID' 
                });
                if (response?.userId) {
                    // Store the userId in both storages
                    await browserAPI.storage.local.set({ _id: response.userId });
                    await storageSet({ userId: response.userId });
                    return response.userId;
                }
            } catch (e) {
                continue;
            }
        }
        
        return null;
    } catch (e) {
        console.error('Detailed error in getStremioUserId:', e.message, e.stack);
        return null;
    }
}

async function getUserCredentials() {
    const stremioUserId = await getStremioUserId();
    if (!stremioUserId) {
        console.error('No Stremio user ID found');
        const userIdElement = document.getElementById('userId');
        if (userIdElement) {
            userIdElement.textContent = 'Stremio must be open';
            userIdElement.style.color = '#ff4444';
        }
        return null;
    }

    const data = await storageGet(['userToken', 'tokenTimestamp', 'tokenNonce']);
    return {
        userId: stremioUserId,
        token: data.userToken,
        timestamp: data.tokenTimestamp,
        nonce: data.tokenNonce
    };
}

// Constants for refresh cooldown
const REFRESH_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

async function updateStats(fromRefresh = false) {
    // Use cached stats if available and not a refresh
    if (!fromRefresh && cachedStats) {
        document.getElementById('segmentsCount').textContent = cachedStats.segments;
        document.getElementById('votesCount').textContent = cachedStats.votes;
        return;
    }

    const data = await storageGet(['userStats', 'lastStatsRefresh']);
    const stats = data.userStats || { segments: 0, votes: 0 };
    cachedStats = stats;  // Update cache
    
    document.getElementById('segmentsCount').textContent = stats.segments;
    document.getElementById('votesCount').textContent = stats.votes;

    if (fromRefresh) {
        await storageSet({ lastStatsRefresh: Date.now() });
        updateRefreshButton();
    }
}

function updateRefreshButton() {
    const refreshButton = document.getElementById('refreshStats');
    if (!refreshButton) return;

    storageGet(['lastStatsRefresh']).then(data => {
        const lastRefresh = data.lastStatsRefresh || 0;
        const now = Date.now();
        const timeSinceLastRefresh = now - lastRefresh;
        const canRefresh = timeSinceLastRefresh >= REFRESH_COOLDOWN_MS;

        refreshButton.disabled = !canRefresh;
        
        if (!canRefresh) {
            const timeLeft = Math.ceil((REFRESH_COOLDOWN_MS - timeSinceLastRefresh) / (60 * 1000));
            refreshButton.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
                </svg>
                <span>${timeLeft}m</span>`;
        } else {
            refreshButton.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
                </svg>
                <span>Refresh</span>`;
        }
    });
}

async function handleRefreshClick() {
    const refreshButton = document.getElementById('refreshStats');
    if (!refreshButton || refreshButton.disabled) return;

    refreshButton.classList.add('spinning');
    
    try {
        await syncStatsWithServer();
        await updateStats(true);
    } catch (error) {
        console.error('Failed to refresh stats:', error);
    } finally {
        refreshButton.classList.remove('spinning');
        updateRefreshButton();
    }
}

async function updateUserStats(newStats) {
    cachedStats = newStats;  // Update cache
    await storageSet({ userStats: newStats });
    document.getElementById('segmentsCount').textContent = newStats.segments;
    document.getElementById('votesCount').textContent = newStats.votes;
}

async function syncStatsWithServer(retryCount = 0) {
    const MAX_RETRIES = 3;
    const RETRY_DELAYS = [2000, 5000, 10000];

    try {
        let credentials = await getUserCredentials();
        if (!credentials?.userId || !credentials?.token || !credentials?.timestamp || !credentials?.nonce) {
            const renewed = await checkAndRenewToken();
            if (!renewed) return;
            credentials = renewed;
        }

        // Fetch the server stats
        const response = await fetch(`${API_BASE_URL}/api/sync-stats`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': API_KEY,
                'X-User-Id': credentials.userId,
                'X-User-Token': credentials.token,
                'X-Token-Timestamp': credentials.timestamp.toString(),
                'X-Token-Nonce': credentials.nonce
            },
            body: JSON.stringify({
                userId: credentials.userId
            })
        });

        if (response.status === 429 && retryCount < MAX_RETRIES) {
            // Rate limited, attempt retry with backoff
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS[retryCount]));
            return syncStatsWithServer(retryCount + 1);
        }

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Stats sync failed:', response.status, errorText);
            
            if (response.status === 401 || response.status === 400) {
                // Clear stored token data if unauthorized
                await storageSet({ 
                    userToken: null, 
                    tokenTimestamp: null,
                    tokenNonce: null
                });
                
                // Try to get a new token
                if (retryCount < MAX_RETRIES) {
                    const delay = RETRY_DELAYS[retryCount];
                    await new Promise(resolve => setTimeout(resolve, delay));
                    return syncStatsWithServer(retryCount + 1);
                }
            }
            return;
        }

        const result = await response.json();
        if (result.success && result.stats) {
            await updateUserStats(result.stats);
        }
    } catch (error) {
        console.error('Error in syncStatsWithServer:', error);
        if (retryCount < MAX_RETRIES) {
            // Retry on network errors
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS[retryCount]));
            return syncStatsWithServer(retryCount + 1);
        }
    }
}

// Move state loading to happen before DOM is ready
async function initializeExtensionState() {
    const data = await storageGet(['isEnabled', 'userStats', 'lastSync']);
    const now = Date.now();
    const lastSync = data.lastSync || 0;
    const SYNC_INTERVAL = 60 * 60 * 1000; // Only sync every 60 minutes

    return {
        isEnabled: data.isEnabled !== undefined ? data.isEnabled : true,
        stats: data.userStats || { segments: 0, votes: 0 },
        needsSync: now - lastSync > SYNC_INTERVAL
    };
}

// Clear stats cache when needed
function clearStatsCache() {
    cachedStats = null;
}

function updateUI(isEnabled) {
    // Update cache
    cachedToggleState = isEnabled;
    const toggleButton = document.getElementById('toggleButton');
    const statusText = document.querySelector('.status');
    if (toggleButton && statusText) {
        toggleButton.checked = isEnabled;
        statusText.style.color = isEnabled ? '#4CAF50' : '#ff4444';
        toggleButton.style.visibility = 'visible';
    }
}

async function updateUserInterface() {
    const credentials = await getUserCredentials();
    const userIdElement = document.getElementById('userId');
    
    if (credentials?.userId) {
        const formattedUserId = credentials.userId.slice(0, 4) + '...' + credentials.userId.slice(-4);
        userIdElement.textContent = formattedUserId;
        userIdElement.style.color = '';  // Reset color
    } else {
        userIdElement.textContent = 'Refresh your Stremio tab';
        userIdElement.style.color = '#ff4444';
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    const toggleButton = document.getElementById('toggleButton');
    const refreshButton = document.getElementById('refreshStats');
    
    // Initialize state and UI
    const initialState = await initializeExtensionState();
    cachedToggleState = initialState.isEnabled;
    updateUI(initialState.isEnabled);
    
    // Always try to load stats from storage first
    const data = await storageGet(['userStats']);
    if (data.userStats) {
        cachedStats = data.userStats;
        document.getElementById('segmentsCount').textContent = data.userStats.segments;
        document.getElementById('votesCount').textContent = data.userStats.votes;
    }
    
    // Then try to get user credentials and update UI
    await updateUserInterface();
    
    // If we need to sync, do it after everything else is ready
    if (initialState.needsSync) {
        await syncStatsWithServer();
        await storageSet({ lastSync: Date.now() });
        await updateStats(true);
    }
    
    // Set up refresh button click handler
    if (refreshButton) {
        refreshButton.addEventListener('click', handleRefreshClick);
        updateRefreshButton();
    }
    
    // Set up toggle button handler
    toggleButton.addEventListener('change', () => {
        const newState = toggleButton.checked;
        storageSet({ isEnabled: newState });
    });

    // Listen for storage changes
    browserAPI.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'sync') {
            if (changes.isEnabled) {
                updateUI(changes.isEnabled.newValue);
            }
            if (changes.userStats || changes.segments || changes.votes) {
                clearStatsCache();
                updateStats();
            }
            if (changes.userToken || changes.tokenTimestamp) {
                clearStatsCache();
                updateUserInterface();
                syncStatsWithServer();
            }
        }
    });

    // Listen for messages from background script
    browserAPI.runtime.onMessage.addListener(async (message) => {
        if (message.type === 'STREMIO_TAB_REFRESHED') {
            await updateUserInterface();
            if (!cachedStats) {
                await syncStatsWithServer();
                await updateStats(true);
            }
        }
    });
});
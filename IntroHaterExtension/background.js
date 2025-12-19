// background.js

// Cross-browser compatibility
const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

// Import API key
import { API_KEY } from './modules/utils.js';

// Helper function to handle storage operations consistently
function storageSet(data) {
    return new Promise(resolve => {
        browserAPI.storage.sync.set(data, resolve);
    });
}

function storageGet(keys) {
    return new Promise(resolve => {
        browserAPI.storage.sync.get(keys, resolve);
    });
}

let isEnabled = true;

// Initialize user credentials
async function initializeUserCredentials() {
    try {
        // Check if we already have credentials
        const data = await storageGet(['userId', 'userToken', 'tokenTimestamp', 'tokenNonce']);
        if (data.userId && data.userToken && data.tokenTimestamp && data.tokenNonce) {
            return; // Already initialized
        }

        // Try to get Stremio user ID from any open Stremio tab
        const tabs = await browserAPI.tabs.query({ url: [
            "*://*.strem.io/*",
            "*://*.stremioapps.com/*",
            "*://web.stremio.com/*",
            "*://app.strem.io/*"
        ]});

        let userId = null;
        for (const tab of tabs) {
            try {
                const response = await browserAPI.tabs.sendMessage(tab.id, { 
                    type: 'GET_STREMIO_USER_ID' 
                });
                if (response?.userId) {
                    userId = response.userId;
                    break;
                }
            } catch (e) {
                // Ignore errors and try next tab
                continue;
            }
        }

        if (userId) {
            // Store the userId
            await storageSet({ userId });

            // Generate new token
            const response = await fetch('https://introhater.com/api/generate-token', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'X-API-Key': API_KEY
                },
                body: JSON.stringify({ userId })
            });
            
            if (response.ok) {
                const { token, timestamp, nonce } = await response.json();
                await storageSet({ 
                    userToken: token, 
                    tokenTimestamp: timestamp,
                    tokenNonce: nonce
                });
            }
        }
    } catch (error) {
        console.error('Error initializing user credentials:', error);
    }
}

// Listen for Stremio tab updates
browserAPI.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url?.match(/strem\.io|stremioapps\.com|web\.stremio\.com|app\.strem\.io/)) {
        try {
            // Wait a moment for the page to fully load
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Try to get user ID from the refreshed tab
            const response = await browserAPI.tabs.sendMessage(tabId, { 
                type: 'GET_STREMIO_USER_ID' 
            });
            
            if (response?.userId) {
                // Store in both storages
                await browserAPI.storage.local.set({ _id: response.userId });
                await storageSet({ userId: response.userId });
                
                // Notify any open popups to refresh
                browserAPI.runtime.sendMessage({ 
                    type: 'STREMIO_TAB_REFRESHED',
                    userId: response.userId 
                });
            }
        } catch (error) {
            // Ignore errors as the content script might not be ready yet
            console.debug('Error getting user ID from refreshed tab:', error);
        }
    }
});

// Initialize state
browserAPI.runtime.onInstalled.addListener(() => {
    storageSet({ isEnabled: true });
    initializeUserCredentials();
});

// Load saved state when background script starts
storageGet('isEnabled').then(data => {
    if (data.isEnabled !== undefined) {
        isEnabled = data.isEnabled;
    }
});

// Listen for messages
browserAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "GET_STATUS") {
        storageGet('isEnabled').then(data => sendResponse({ isEnabled: data.isEnabled }));
        return true;
    } 
    else if (message.type === "TOGGLE_STATUS") {
        isEnabled = !isEnabled;
        storageSet({ isEnabled }).then(() => sendResponse({ isEnabled }));
        return true;
    }
    return true;
});
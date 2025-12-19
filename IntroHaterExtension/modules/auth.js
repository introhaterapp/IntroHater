import { API_BASE_URL, API_KEY } from './utils.js';

// Cross-browser compatibility
const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

export async function getUserCredentials() {
    // We'll get userId from storage as it's already being handled by popup.js
    const data = await browserAPI.storage.sync.get(['userId', 'userToken', 'tokenTimestamp', 'tokenNonce']);
    if (!data.userId) {
return null;
    }
    
    // Validate and convert timestamp to number if it's a string
    let timestamp = data.tokenTimestamp;
    if (typeof timestamp === 'string') {
        timestamp = parseInt(timestamp, 10);
    }
    
    // Ensure token, timestamp and nonce are valid
    if (!data.userToken || !timestamp || isNaN(timestamp) || !data.tokenNonce) {
const renewed = await renewToken(data.userId);
        if (!renewed) return null;
        return renewed;
    }
    
    return {
        userId: data.userId,
        token: data.userToken,
        timestamp: timestamp,
        nonce: data.tokenNonce
    };
}

async function renewToken(userId) {
    if (!userId) return null;

    try {
const response = await fetch(`${API_BASE_URL}/api/generate-token`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'X-API-Key': API_KEY
            },
            body: JSON.stringify({ userId })
        });
        
        if (!response.ok) {
return null;
        }
        
        const { token, timestamp, nonce } = await response.json();
        
        // Ensure we have valid data before storing
        if (!token || !timestamp || !nonce) {
return null;
        }

        // Convert timestamp to number if it's a string
        const numericTimestamp = typeof timestamp === 'string' ? parseInt(timestamp, 10) : timestamp;
        
        if (isNaN(numericTimestamp)) {
return null;
        }

        await browserAPI.storage.sync.set({ 
            userToken: token, 
            tokenTimestamp: numericTimestamp,
            tokenNonce: nonce
        });
        
        return { 
            userId, 
            token,
            timestamp: numericTimestamp,
            nonce
        };
    } catch (error) {
return null;
    }
}

export async function checkAndRenewToken() {
    const credentials = await getUserCredentials();
    if (!credentials?.userId) return null;

    const tokenAge = Date.now() - (credentials.timestamp || 0);
    const tokenLifespan = 30 * 24 * 60 * 60 * 1000; // 30 days
    const renewThreshold = 23 * 24 * 60 * 60 * 1000; // Renew after 23 days

    if (!credentials.token || !credentials.timestamp || !credentials.nonce || tokenAge > renewThreshold) {
return await renewToken(credentials.userId);
    }
    return credentials;
}

export async function handleTokenError(error) {
    if (error.status === 401 || error.status === 400) {
return checkAndRenewToken();
    }
    return null;
}
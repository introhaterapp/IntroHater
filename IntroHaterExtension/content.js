// Cross-browser compatibility
const browserAPI = typeof browser !== 'undefined' ? browser : chrome;
const moduleURL = browserAPI.runtime.getURL('modules/');

// Helper function to handle storage operations consistently
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

// Initialize utils module first since it contains API_KEY
let utils;
async function initModules() {
    if (!utils) {
        utils = await import(moduleURL + 'utils.js');
    }
    return utils;
}

// Check and initialize credentials if needed
async function checkCredentials() {
    try {
        utils = await initModules();
        
        const data = await storageGet(['userId', 'userToken', 'tokenTimestamp', 'tokenNonce']);
        if (!data.userId || !data.userToken || !data.tokenTimestamp || !data.tokenNonce) {
            const profileData = localStorage.getItem('profile');
            if (profileData) {
                const profile = JSON.parse(profileData);
                const userId = profile?.auth?.user?._id;
                if (userId) {
                    try {
                        // Generate new token
                        const response = await fetch('https://introhater.com/api/generate-token', {
                            method: 'POST',
                            headers: { 
                                'Content-Type': 'application/json',
                                'X-API-Key': utils.API_KEY
                            },
                            body: JSON.stringify({ userId })
                        });
                        
                        if (!response.ok) {
                            throw new Error(`HTTP error! status: ${response.status}`);
                        }
                        
                        const responseData = await response.json();
                        if (responseData.token && responseData.timestamp && responseData.nonce) {
                            await storageSet({ 
                                userId,
                                userToken: responseData.token, 
                                tokenTimestamp: responseData.timestamp,
                                tokenNonce: responseData.nonce
                            });
                        } else {
                            throw new Error('Invalid token response format');
                        }
                    } catch (apiError) {
                        console.error('API error:', apiError);
                        throw apiError;
                    }
                }
            }
        }
    } catch (error) {
        console.error('Error initializing credentials:', error);
        throw error;
    }
}

async function loadModules() {
    try {
        // Load utils first since other modules depend on it
        const utils = await import(moduleURL + 'utils.js');
        
        const modules = {
            utils,
            player: await import(moduleURL + 'player.js'),
            visualization: await import(moduleURL + 'visualization.js'),
            notifications: await import(moduleURL + 'notifications.js'),
            controls: await import(moduleURL + 'controls.js')
        };
        
        // Check credentials before initializing content script
        await checkCredentials();
        initializeContentScript(modules);
    } catch (error) {
        console.error('Error loading modules:', error);
    }
}

function initializeContentScript(modules) {
    let videoPlayer = null;
    let segmentVisualizer = null;
    let checkInterval = null;
    let lastUrl = location.href;
    let segmentUIController = null;
    let currentVideoId = null;
    let lastInitTime = 0;  // Track last initialization time

    function cleanup() {
        if (checkInterval) {
            clearInterval(checkInterval);
            checkInterval = null;
        }
        if (segmentVisualizer) {
            segmentVisualizer.clear();
            segmentVisualizer.destroy();
            segmentVisualizer = null;
        }
        if (segmentUIController) {
            segmentUIController.destroy();
            segmentUIController = null;
        }
        currentVideoId = null;
        videoPlayer = null;
    }

    async function handleUrlChange() {
        const currentUrl = location.href;
        if (currentUrl !== lastUrl) {
            lastUrl = currentUrl;
            
            // Clean up existing state
            cleanup();
            
            // Wait a moment for any pending operations to complete
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Start fresh
            startMonitoring();
        }
    }

    function updateStats(wasSkipped) {
        if (wasSkipped) {
            storageGet(['userStats']).then(data => {
                const stats = data.userStats || { segments: 0, votes: 0 };
                // Removed votes increment as it should only happen when user actually votes
                storageSet({ userStats: stats });
            });
        }
    }

    function startMonitoring() {
        modules.player.findPlayer(async (foundPlayer) => {
            if (!foundPlayer) return;
            
            videoPlayer = foundPlayer;
            
            // Get video ID first
            const videoId = modules.utils.getVideoIdFromURL(window.location.href);
            if (!videoId) {
                return;
            }

            const currentTime = Date.now();
            if (videoId === currentVideoId && (currentTime - lastInitTime) < 2000) {
                return;
            }

            currentVideoId = videoId;
            lastInitTime = currentTime;
            
            try {
                // Initialize visualizer with retries
                segmentVisualizer = await modules.player.initializeVisualization(
                    videoPlayer, 
                    modules.visualization.createSegmentVisualizer
                );

                if (!segmentVisualizer) {
                    return;
                }

                // Initialize segment UI controller
                segmentUIController = new modules.controls.SegmentUIController(videoPlayer, (action, time) => {
                    if (!segmentVisualizer) return;
                    
                    if (action === 'start') {
                        segmentVisualizer.setStartTime(time);
                    } else if (action === 'end') {
                        segmentVisualizer.setEndTime(time);
                    } else if (action === 'clear') {
                        segmentVisualizer.clear();
                    } else if (action === 'getEndTime') {
                        return segmentVisualizer.getEndTime();
                    }
                });
                segmentUIController.createSegmentUI();
                
                // Fetch segments and visualize them
                const segments = await modules.player.fetchSkipSegments(videoId, modules.utils.API_BASE_URL, segmentVisualizer);
                
                if (segments.length > 0 && videoId === currentVideoId) { // Only set up if video hasn't changed
                    checkInterval = setInterval(() => {
                        if (videoPlayer.readyState >= 1) {  // Only check if player is ready
                            const wasSkipped = modules.player.checkAndSkip(
                                videoPlayer, 
                                segments,
                                true,
                                modules.notifications.showSkipNotification
                            );
                            updateStats(wasSkipped);
                        }
                    }, 250);
                }
            } catch (error) {
                cleanup();
            }
        });
    }

    // Start monitoring when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startMonitoring);
    } else {
        startMonitoring();
    }

    // Watch for URL changes
    const observer = new MutationObserver(() => handleUrlChange());
    observer.observe(document, { subtree: true, childList: true });

    // Cleanup on unload
    window.addEventListener('unload', () => {
        cleanup();
        observer.disconnect();
    });
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'GET_STREMIO_USER_ID') {
        try {
            const profileData = localStorage.getItem('profile');
            if (!profileData) {
                sendResponse({ userId: null });
                return true;
            }
            
            const profile = JSON.parse(profileData);
            // Fix: correct path to user ID in the profile object
            const userId = profile?.auth?.user?._id || null;
            sendResponse({ userId });
        } catch (e) {
            console.error('Detailed error parsing Stremio profile:', e.message, e.stack);
            sendResponse({ userId: null });
        }
        return true; // Keep the message channel open for async response
    }
    return true;
});

loadModules().catch(error => {
    console.error('Error loading modules:', error);
});

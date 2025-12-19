
// Cross-browser compatibility
const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

export class NavigationManager {
    constructor(onUrlChange) {
        this.lastUrl = location.href;
        this.onUrlChange = onUrlChange;
        this.observer = null;
    }

    startObserving() {
        this.observer = new MutationObserver(() => {
            const currentUrl = location.href;
            if (currentUrl !== this.lastUrl) {
this.lastUrl = currentUrl;
this.onUrlChange(currentUrl);
            }
        });

        this.observer.observe(document, { subtree: true, childList: true });
        return this;
    }

    stopObserving() {
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }
    }
}

export class StateManager {
    constructor() {
        this.isEnabled = true;
        this.currentVideoId = null;
        this.skipSegments = [];
    }

    setupListeners(onStateChange) {
        // Initialize state from storage
        browserAPI.storage.sync.get('isEnabled', (data) => {
            if (data.isEnabled !== undefined) {
this.isEnabled = data.isEnabled;
                onStateChange(this.isEnabled);
            }
        });

        // Listen for storage changes
        browserAPI.storage.onChanged.addListener((changes, namespace) => {
            if (namespace === 'sync' && changes.isEnabled) {
this.isEnabled = changes.isEnabled.newValue;
                onStateChange(this.isEnabled);
            }
        });

        // Listen for runtime messages
        browserAPI.runtime.onMessage.addListener((message) => {
            if (message.type === "STATUS_CHANGED") {
this.isEnabled = message.isEnabled;
                onStateChange(this.isEnabled);
            }
        });
    }

    setVideoId(videoId) {
        this.currentVideoId = videoId;
    }

    setSkipSegments(segments) {
        this.skipSegments = segments;
    }

    getState() {
        return {
            isEnabled: this.isEnabled,
            currentVideoId: this.currentVideoId,
            skipSegments: this.skipSegments
        };
    }
}
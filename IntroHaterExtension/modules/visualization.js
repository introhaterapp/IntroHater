export function createSegmentVisualizer(player, slider) {
    let segmentStartTime = null;
    let segmentEndTime = null;
    let visualizationAttempts = 0;
    const maxAttempts = 20; // Increased to 20 to allow more time for metadata
    let destroyed = false;
    let pendingUpdate = null;
    let pendingIndicators = [];

    function ensurePlayerReady(callback) {
        if (destroyed) {
return;
        }

        const tryVisualize = () => {
            if (player.readyState >= 1 && player.duration > 0) {
callback();
                return true;
            }
            return false;
        };
        
        // Try immediately first
        if (tryVisualize()) return;

        if (visualizationAttempts >= maxAttempts) {
return;
        }
visualizationAttempts++;
        
        // Clear any existing pending update
        if (pendingUpdate) {
            clearTimeout(pendingUpdate);
        }

        // Set up metadata event listener
        const handleMetadata = () => {
if (tryVisualize()) {
                player.removeEventListener('loadedmetadata', handleMetadata);
                if (pendingUpdate) {
                    clearTimeout(pendingUpdate);
                    pendingUpdate = null;
                }
            }
        };
        player.addEventListener('loadedmetadata', handleMetadata);
        
        // Schedule next attempt as backup
        pendingUpdate = setTimeout(() => {
            pendingUpdate = null;
            player.removeEventListener('loadedmetadata', handleMetadata);
            ensurePlayerReady(callback);
        }, 500);
    }

    function updateSegmentIndicator() {
        return ensurePlayerReady(() => {
            if (!player || segmentStartTime == null || !player.duration) return;
            if (!slider || !slider.isConnected) return;
            
            let indicator = document.getElementById('segment-indicator');
            if (!indicator) {
                indicator = document.createElement('div');
                indicator.id = 'segment-indicator';
                indicator.style.position = 'absolute';
                indicator.style.width = '2px';
                indicator.style.backgroundColor = 'orange';
                indicator.style.pointerEvents = 'none';
                slider.appendChild(indicator);
            }
            
            const track = slider.querySelector('[class^="track-"]');
            if (track) {
                const trackRect = track.getBoundingClientRect();
                const sliderRect = slider.getBoundingClientRect();
                indicator.style.height = trackRect.height + 'px';
                indicator.style.top = (trackRect.top - sliderRect.top) + 'px';
            } else {
                indicator.style.height = '100%';
                indicator.style.top = '0';
            }

            const validatedTime = Math.max(0, Math.min(segmentStartTime, player.duration));
            const percent = (validatedTime / player.duration) * 100;
            indicator.style.left = `calc(${percent}% - 1px)`;
            
            if (segmentEndTime != null) updateSegmentRange();
            
            return indicator;
        });
    }

    function updateSegmentEndIndicator() {
        return ensurePlayerReady(() => {
            if (!player || segmentEndTime == null || !player.duration) return;
            if (!slider || !slider.isConnected) return;
            
            let indicator = document.getElementById('segment-end-indicator');
            if (!indicator) {
                indicator = document.createElement('div');
                indicator.id = 'segment-end-indicator';
                indicator.style.position = 'absolute';
                indicator.style.width = '2px';
                indicator.style.backgroundColor = 'red';
                indicator.style.pointerEvents = 'none';
                slider.appendChild(indicator);
            }
            
            const track = slider.querySelector('[class^="track-"]');
            if (track) {
                const trackRect = track.getBoundingClientRect();
                const sliderRect = slider.getBoundingClientRect();
                indicator.style.height = trackRect.height + 'px';
                indicator.style.top = (trackRect.top - sliderRect.top) + 'px';
            } else {
                indicator.style.height = '100%';
                indicator.style.top = '0';
            }

            const validatedTime = Math.max(0, Math.min(segmentEndTime, player.duration));
            const percent = (validatedTime / player.duration) * 100;
            indicator.style.left = `calc(${percent}% - 1px)`;
            
            if (segmentStartTime != null) updateSegmentRange();
            
            return indicator;
        });
    }

    function updateSegmentRange() {
        return ensurePlayerReady(() => {
            if (!player || segmentStartTime == null || segmentEndTime == null || !player.duration) return;
            if (!slider || !slider.isConnected) return;
            
            let range = document.getElementById('segment-range');
            if (!range) {
                range = document.createElement('div');
                range.id = 'segment-range';
                range.style.position = 'absolute';
                range.style.backgroundColor = 'rgba(0,255,0,0.5)';
                range.style.pointerEvents = 'none';
                slider.appendChild(range);
            }
            
            const track = slider.querySelector('[class^="track-"]');
            if (track) {
                const trackRect = track.getBoundingClientRect();
                const sliderRect = slider.getBoundingClientRect();
                range.style.height = trackRect.height + 'px';
                range.style.top = (trackRect.top - sliderRect.top) + 'px';
            } else {
                range.style.height = '100%';
                range.style.top = '0';
            }
            
            const validatedStart = Math.max(0, Math.min(segmentStartTime, player.duration));
            const validatedEnd = Math.max(0, Math.min(segmentEndTime, player.duration));
            
            const startPercent = (validatedStart / player.duration) * 100;
            const endPercent = (validatedEnd / player.duration) * 100;
            range.style.left = `calc(${startPercent}% + 2px)`;
            range.style.width = `calc(${endPercent - startPercent}% - 4px)`;
            
            return range;
        });
    }

    function removeAll() {
        ['segment-indicator', 'segment-end-indicator', 'segment-range'].forEach(id => {
            const element = document.getElementById(id);
            if (element) element.remove();
        });
    }

    // Create an observer to watch for slider element removal
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.removedNodes.forEach((node) => {
                if (node === slider || node.contains(slider)) {
                    removeAll();
                }
            });
        });
    });

    if (slider && slider.parentNode) {
        observer.observe(slider.parentNode, { childList: true, subtree: true });
    }

    return {
        setStartTime: (time) => {
segmentStartTime = time;
            visualizationAttempts = 0;
            destroyed = false;
            pendingIndicators.push('start');
            
            // Clear any pending update when setting new time
            if (pendingUpdate) {
                clearTimeout(pendingUpdate);
                pendingUpdate = null;
            }
            
            // Try update or queue it
            const result = updateSegmentIndicator();
            if (result && pendingIndicators.includes('end')) {
                updateSegmentRange();
            }
            return result;
        },
        setEndTime: (time) => {
segmentEndTime = time;
            visualizationAttempts = 0;
            destroyed = false;
            pendingIndicators.push('end');
            
            // Clear any pending update when setting new time
            if (pendingUpdate) {
                clearTimeout(pendingUpdate);
                pendingUpdate = null;
            }
            
            // Try update or queue it
            const result = updateSegmentEndIndicator();
            if (result && pendingIndicators.includes('start')) {
                updateSegmentRange();
            }
            return result;
        },
        clear: () => {
if (pendingUpdate) {
                clearTimeout(pendingUpdate);
                pendingUpdate = null;
            }
            removeAll();
            segmentStartTime = null;
            segmentEndTime = null;
            destroyed = false;
            visualizationAttempts = 0;
            pendingIndicators = [];
        },
        destroy: () => {
if (pendingUpdate) {
                clearTimeout(pendingUpdate);
                pendingUpdate = null;
            }
            observer.disconnect();
            removeAll();
            destroyed = true;
            pendingIndicators = [];
        },
        getStartTime: () => segmentStartTime,
        getEndTime: () => segmentEndTime
    };
}
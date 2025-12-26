document.addEventListener('DOMContentLoaded', () => {
    // Header Scroll Effect
    const header = document.querySelector('header');

    window.addEventListener('scroll', () => {
        if (window.scrollY > 20) {
            header.style.background = 'rgba(9, 9, 11, 0.85)';
            header.style.borderBottom = '1px solid rgba(255, 255, 255, 0.1)';
            header.style.boxShadow = '0 10px 30px -10px rgba(0, 0, 0, 0.5)';
        } else {
            header.style.background = 'transparent';
            header.style.borderBottom = '1px solid transparent';
            header.style.boxShadow = 'none';
        }
    });

    // Mobile Menu Toggle
    const headerEl = document.querySelector('header');
    const menuBtn = document.createElement('button');
    menuBtn.className = 'menu-toggle';
    menuBtn.innerHTML = '<span></span><span></span><span></span>';

    // Insert menu toggle into the container
    const headerContainer = document.querySelector('header .container');
    if (headerContainer) {
        headerContainer.appendChild(menuBtn);
    }

    menuBtn.addEventListener('click', () => {
        headerEl.classList.toggle('header-active');
        document.body.style.overflow = headerEl.classList.contains('header-active') ? 'hidden' : '';
    });

    // Close menu when clicking links
    document.querySelectorAll('.nav-links a').forEach(link => {
        link.addEventListener('click', () => {
            headerEl.classList.remove('header-active');
            document.body.style.overflow = '';
        });
    });

    // Close menu when clicking outside
    document.addEventListener('click', (e) => {
        if (headerEl.classList.contains('header-active') && !headerEl.contains(e.target) && !menuBtn.contains(e.target)) {
            headerEl.classList.remove('header-active');
            document.body.style.overflow = '';
        }
    });

    const observerOptions = {
        threshold: 0.15,
        rootMargin: '0px 0px -50px 0px'
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry, index) => {
            if (entry.isIntersecting) {
                // Add staggered delay based on elements within same group if possible
                // For now, just trigger the animation
                setTimeout(() => {
                    entry.target.classList.add('animate-active');
                }, index * 100);
                observer.unobserve(entry.target);
            }
        });
    }, observerOptions);

    document.querySelectorAll('.reveal-on-scroll, .card, .stat-card').forEach(el => {
        el.classList.add('reveal-init');
        observer.observe(el);
    });

    // Fetch Real Stats
    fetchStats();
});

const API_BASE_URL = window.location.protocol === 'file:' ? 'http://localhost:7005' : '';

async function fetchStats() {
    try {
        const res = await fetch(`${API_BASE_URL}/api/stats`);
        if (!res.ok) return;
        const data = await res.json();

        /**
         * Smoothly animates a numeric value
         */
        const animateCount = (id, targetValue, duration = 1500, suffix = '') => {
            const el = document.getElementById(id);
            if (!el) return;

            const startValue = 0;
            const startTime = performance.now();

            const update = (currentTime) => {
                const elapsed = currentTime - startTime;
                const progress = Math.min(elapsed / duration, 1);

                // Ease out cubic
                const easeProgress = 1 - Math.pow(1 - progress, 3);
                const currentValue = Math.floor(easeProgress * (targetValue - startValue) + startValue);

                let displayValue = currentValue;
                // Formatting for large numbers
                if (currentValue >= 1000000) displayValue = (currentValue / 1000000).toFixed(1) + 'M';
                else if (currentValue >= 10000) displayValue = (currentValue / 1000).toFixed(0) + 'k';
                else if (currentValue >= 1000) displayValue = (currentValue / 1000).toFixed(1) + 'k';

                el.innerText = displayValue + suffix;

                if (progress < 1) {
                    requestAnimationFrame(update);
                } else {
                    // Final precise formatting
                    let finalDisplay = targetValue;
                    if (targetValue >= 1000000) finalDisplay = (targetValue / 1000000).toFixed(1) + 'M';
                    else if (targetValue >= 10000) finalDisplay = (targetValue / 1000).toFixed(0) + 'k';
                    else if (targetValue >= 1000) finalDisplay = (targetValue / 1000).toFixed(1) + 'k';
                    el.innerText = finalDisplay + suffix;
                }
            };

            requestAnimationFrame(update);
        };

        animateCount('stat-users', data.users || 0);
        animateCount('stat-shows', data.showCount || 0);
        animateCount('stat-skips', data.skips || 0);
        animateCount('stat-episodes', data.episodeCount || 0);

        // Saved Time - Animate the numeric part if possible, but simpler to just set the string for time units
        const savedSec = data.savedTime || 0;
        let targetValue = 0;
        let suffix = 's';

        if (savedSec >= 86400) { targetValue = savedSec / 86400; suffix = 'd'; }
        else if (savedSec >= 3600) { targetValue = savedSec / 3600; suffix = 'h'; }
        else if (savedSec >= 60) { targetValue = savedSec / 60; suffix = 'm'; }
        else { targetValue = savedSec; suffix = 's'; }

        // For units like days/hours, we want one decimal place in the count-up too
        const animateTime = (id, target, suff) => {
            const el = document.getElementById(id);
            if (!el) return;
            const startTime = performance.now();
            const duration = 1500;

            const updateTime = (currentTime) => {
                const elapsed = currentTime - startTime;
                const progress = Math.min(elapsed / duration, 1);
                const easeProgress = 1 - Math.pow(1 - progress, 3);
                const current = (easeProgress * target).toFixed(suff === 's' || suff === 'm' ? 0 : 1);
                el.innerText = current + suff;
                if (progress < 1) requestAnimationFrame(updateTime);
            };
            requestAnimationFrame(updateTime);
        };

        animateTime('stat-saved', targetValue, suffix);

    } catch (e) {
        console.error("Stats error:", e);
    }
}

/**
 * Creates a skeleton placeholder element
 * @param {string} type - 'text', 'title', 'chip', 'circle'
 * @returns {string} HTML string
 */
function createSkeleton(type = 'text', count = 1) {
    let skeletons = '';
    for (let i = 0; i < count; i++) {
        skeletons += `<div class="skeleton skeleton-${type}"></div>`;
    }
    return skeletons;
}

window.createSkeleton = createSkeleton;

// Init Ticker if on Home (called from DOMContentLoaded above via fetchStats flow, but fallback here)
document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('ticker-content')) {
        initTicker();
    }
});

async function initTicker() {
    const el = document.getElementById('ticker-content');
    if (!el) return;

    let tickerData = [];
    let currentIndex = 0;
    let ws = null;
    let wsRetries = 0;
    const maxRetries = 5;

    // Rotation function to cycle through items
    const rotate = () => {
        if (tickerData.length === 0) return;

        const item = tickerData[currentIndex];
        const timeAgo = Math.floor((new Date() - new Date(item.timestamp)) / 60000);
        const timeStr = timeAgo < 1 ? 'just now' : `${timeAgo}m ago`;

        el.style.opacity = 0;
        setTimeout(() => {
            const displayName = item.title || item.videoId.split(':')[0];
            const episodePart = item.episode ? ` ${item.episode}` : '';
            el.innerText = `${displayName}${episodePart} - ${item.label} skip added ${timeStr}`;
            el.style.opacity = 1;
        }, 500);

        currentIndex = (currentIndex + 1) % tickerData.length;
    };

    // Add new item with "pop" animation
    const addItem = (item) => {
        // Add to front and limit to 20 items
        tickerData = [item, ...tickerData].slice(0, 20);
        currentIndex = 0; // Reset to show newest first

        // Flash animation for new item
        el.style.transform = 'scale(1.05)';
        setTimeout(() => {
            el.style.transform = 'scale(1)';
        }, 300);
    };

    // WebSocket connection
    const connectWebSocket = () => {
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${wsProtocol}//${window.location.host}/ws/ticker`;

        try {
            ws = new WebSocket(wsUrl);

            ws.onopen = () => {
                console.log('[Ticker] WebSocket connected');
                wsRetries = 0;
            };

            ws.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data);
                    if (msg.type === 'new_segment' && msg.data) {
                        addItem(msg.data);
                        rotate(); // Immediately show new item
                    }
                } catch (e) {
                    console.warn('[Ticker] Message parse error:', e);
                }
            };

            ws.onclose = () => {
                console.log('[Ticker] WebSocket closed');
                ws = null;
                // Retry with exponential backoff
                if (wsRetries < maxRetries) {
                    wsRetries++;
                    setTimeout(connectWebSocket, Math.min(1000 * Math.pow(2, wsRetries), 30000));
                }
            };

            ws.onerror = (err) => {
                console.warn('[Ticker] WebSocket error, falling back to polling');
            };
        } catch (e) {
            console.warn('[Ticker] WebSocket not available, using polling only');
        }
    };

    // Initial data fetch via polling
    try {
        const res = await fetch(`${API_BASE_URL}/api/activity`);
        const data = await res.json();
        if (data && data.length > 0) {
            tickerData = data;
            el.style.transition = 'opacity 0.5s ease, transform 0.3s ease';
            rotate();
            setInterval(rotate, 5000);
        }
    } catch (e) {
        console.warn("[Ticker] Initial fetch failed:", e);
    }

    // Try WebSocket connection
    if (typeof WebSocket !== 'undefined') {
        connectWebSocket();
    }
}


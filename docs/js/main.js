document.addEventListener('DOMContentLoaded', () => {

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


    const menuBtn = document.getElementById('menuToggle');
    const mainNav = document.getElementById('mainNav');

    if (menuBtn && mainNav) {
        menuBtn.addEventListener('click', () => {
            menuBtn.classList.toggle('active');
            mainNav.classList.toggle('open');
            document.body.style.overflow = mainNav.classList.contains('open') ? 'hidden' : '';
        });


        document.querySelectorAll('.nav-links a').forEach(link => {
            link.addEventListener('click', () => {
                menuBtn.classList.remove('active');
                mainNav.classList.remove('open');
                document.body.style.overflow = '';
            });
        });


        document.addEventListener('click', (e) => {
            if (mainNav.classList.contains('open') && !header.contains(e.target)) {
                menuBtn.classList.remove('active');
                mainNav.classList.remove('open');
                document.body.style.overflow = '';
            }
        });
    }

    const observerOptions = {
        threshold: 0.15,
        rootMargin: '0px 0px -50px 0px'
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry, index) => {
            if (entry.isIntersecting) {


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


    fetchStats();
    initServiceStatus();
});

const API_BASE_URL = (window.location.protocol === 'file:' || window.location.hostname === 'localhost') ? 'http://localhost:7005' : '';
console.log("[IntroHater] API_BASE_URL:", API_BASE_URL || "/");

async function fetchStats() {
    try {
        const res = await fetch(`${API_BASE_URL}/api/stats`);
        if (!res.ok) return;
        const data = await res.json();


        const animateCount = (id, targetValue, duration = 1500, suffix = '') => {
            const el = document.getElementById(id);
            if (!el) return;

            const startValue = 0;
            const startTime = performance.now();

            const update = (currentTime) => {
                const elapsed = currentTime - startTime;
                const progress = Math.min(elapsed / duration, 1);


                const easeProgress = 1 - Math.pow(1 - progress, 3);
                const currentValue = Math.floor(easeProgress * (targetValue - startValue) + startValue);

                let displayValue = currentValue;

                if (currentValue >= 1000000) displayValue = (currentValue / 1000000).toFixed(1) + 'M';
                else if (currentValue >= 10000) displayValue = (currentValue / 1000).toFixed(0) + 'k';
                else if (currentValue >= 1000) displayValue = (currentValue / 1000).toFixed(1) + 'k';

                el.innerText = displayValue + suffix;

                if (progress < 1) {
                    requestAnimationFrame(update);
                } else {

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


        const savedSec = data.savedTime || 0;
        let targetValue = 0;
        let suffix = 's';

        if (savedSec >= 86400) { targetValue = savedSec / 86400; suffix = 'd'; }
        else if (savedSec >= 3600) { targetValue = savedSec / 3600; suffix = 'h'; }
        else if (savedSec >= 60) { targetValue = savedSec / 60; suffix = 'm'; }
        else { targetValue = savedSec; suffix = 's'; }


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


function createSkeleton(type = 'text', count = 1) {
    let skeletons = '';
    for (let i = 0; i < count; i++) {
        skeletons += `<div class="skeleton skeleton-${type}"></div>`;
    }
    return skeletons;
}

window.createSkeleton = createSkeleton;


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


    const addItem = (item) => {

        tickerData = [item, ...tickerData].slice(0, 20);
        currentIndex = 0;


        el.style.transform = 'scale(1.05)';
        setTimeout(() => {
            el.style.transform = 'scale(1)';
        }, 300);
    };


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
                        rotate();
                    }
                } catch (e) {
                    console.warn('[Ticker] Message parse error:', e);
                }
            };

            ws.onclose = () => {
                console.log('[Ticker] WebSocket closed');
                ws = null;

                if (wsRetries < maxRetries) {
                    wsRetries++;
                    setTimeout(connectWebSocket, Math.min(1000 * Math.pow(2, wsRetries), 30000));
                }
            };

            ws.onerror = () => {
                console.warn('[Ticker] WebSocket error, falling back to polling');
            };
        } catch {
            console.warn('[Ticker] WebSocket not available, using polling only');
        }
    };


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


    if (typeof WebSocket !== 'undefined') {
        connectWebSocket();
    }
}


// --- Debrid Configuration ---
const DEBRID_PROVIDERS = {
    realdebrid: { name: 'Real-Debrid', shortName: 'RD', keyUrl: 'https://real-debrid.com/apitoken' },
    torbox: { name: 'TorBox', shortName: 'TB', keyUrl: 'https://torbox.app/settings' },
    premiumize: { name: 'Premiumize', shortName: 'PM', keyUrl: 'https://www.premiumize.me/account' },
    alldebrid: { name: 'AllDebrid', shortName: 'AD', keyUrl: 'https://alldebrid.com/apikeys/' }
};

function getDebridConfig() {
    let provider = localStorage.getItem('introhater_provider');
    let debridKey = localStorage.getItem('introhater_debridkey');
    let externalScraper = localStorage.getItem('introhater_external_scraper');
    let proxyUrl = localStorage.getItem('introhater_proxy_url');
    let proxyPassword = localStorage.getItem('introhater_proxy_password');

    // Secondary providers: stored as JSON array [{provider, key}, ...]
    let secondaryProviders = [];
    try {
        const stored = localStorage.getItem('introhater_secondary_providers');
        if (stored) secondaryProviders = JSON.parse(stored);
    } catch { }

    // Migration logic for old rdKey format
    if (!debridKey) {
        const oldKey = localStorage.getItem('introhater_rdkey');
        if (oldKey) {
            provider = 'realdebrid';
            debridKey = oldKey;
            localStorage.setItem('introhater_provider', 'realdebrid');
            localStorage.setItem('introhater_debridkey', oldKey);
        }
    }

    return { provider, debridKey, secondaryProviders, externalScraper, proxyUrl, proxyPassword };
}

function setDebridConfig(provider, debridKey, options = {}) {
    localStorage.setItem('introhater_provider', provider);
    localStorage.setItem('introhater_debridkey', debridKey);

    if (options.externalScraper) {
        localStorage.setItem('introhater_external_scraper', options.externalScraper);
    } else {
        localStorage.removeItem('introhater_external_scraper');
    }

    if (options.proxyUrl) {
        localStorage.setItem('introhater_proxy_url', options.proxyUrl);
    } else {
        localStorage.removeItem('introhater_proxy_url');
    }

    if (options.proxyPassword) {
        localStorage.setItem('introhater_proxy_password', options.proxyPassword);
    } else {
        localStorage.removeItem('introhater_proxy_password');
    }

    // Secondary providers: array of {provider, key}
    if (options.secondaryProviders && options.secondaryProviders.length > 0) {
        localStorage.setItem('introhater_secondary_providers', JSON.stringify(options.secondaryProviders));
    } else {
        localStorage.removeItem('introhater_secondary_providers');
    }
}

function clearDebridConfig() {
    localStorage.removeItem('introhater_provider');
    localStorage.removeItem('introhater_debridkey');
    localStorage.removeItem('introhater_external_scraper');
    localStorage.removeItem('introhater_proxy_url');
    localStorage.removeItem('introhater_proxy_password');
    localStorage.removeItem('introhater_secondary_providers');
    localStorage.removeItem('introhater_rdkey'); // Clear legacy key too
}


window.DEBRID_PROVIDERS = DEBRID_PROVIDERS;
window.getDebridConfig = getDebridConfig;
window.setDebridConfig = setDebridConfig;
window.clearDebridConfig = clearDebridConfig;

async function initServiceStatus() {
    console.log("[IntroHater] Initializing Service Status dashboard...");
    const statusGrid = document.getElementById('service-status-grid');
    if (!statusGrid) {
        console.warn("[IntroHater] Service status grid element not found!");
        return;
    }

    const fetchStatus = async () => {
        try {
            const res = await fetch(`${API_BASE_URL}/api/status?t=${Date.now()}`);
            if (!res.ok) {
                statusGrid.innerHTML = `<div class="status-error">Health API returned ${res.status}</div>`;
                return;
            }
            const data = await res.json();
            console.log("[Status] Received health data:", data);

            if (!data || Object.keys(data).length === 0) {
                statusGrid.innerHTML = '<div class="status-loading">No status data available</div>';
                return;
            }

            statusGrid.innerHTML = '';
            Object.entries(data).forEach(([, service]) => {
                const card = document.createElement('div');
                card.className = `status-card status-${service.status}`;

                let statusLabel = service.status;
                if (service.status === 'online') statusLabel = 'Online';
                else if (service.status === 'blocked') statusLabel = 'HTTP 403 (Blocked)';
                else if (service.status === 'offline') statusLabel = 'Offline';
                else if (service.status === 'degraded') statusLabel = 'Degraded';

                card.innerHTML = `
                    <div class="status-header">
                        <span class="status-name">${service.name}</span>
                        <span class="status-indicator"></span>
                    </div>
                    <div class="status-details">
                        <span class="status-label">${statusLabel}</span>
                        ${service.latency ? `<span class="status-latency">${service.latency}ms</span>` : ''}
                    </div>
                `;
                statusGrid.appendChild(card);
            });
        } catch (e) {
            console.error("Status fetch error:", e);
            statusGrid.innerHTML = `<div class="status-error">Failed to connect to health API</div>`;
        }
    };

    fetchStatus();
    setInterval(fetchStatus, 60000);
}

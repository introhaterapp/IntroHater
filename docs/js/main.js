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
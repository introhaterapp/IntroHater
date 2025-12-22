document.addEventListener('DOMContentLoaded', () => {
    // Header Scroll Effect
    const header = document.querySelector('header');

    window.addEventListener('scroll', () => {
        if (window.scrollY > 50) {
            header.style.background = 'rgba(5, 5, 16, 0.95)';
            header.style.boxShadow = '0 4px 20px rgba(0, 0, 0, 0.4)';
        } else {
            header.style.background = 'rgba(5, 5, 16, 0.8)';
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

    // Intersection Observer for fade-in animations
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px'
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('animate-fade-in');
                observer.unobserve(entry.target);
            }
        });
    }, observerOptions);

    document.querySelectorAll('.reveal-on-scroll').forEach(el => {
        observer.observe(el);
    });

    // Fetch Real Stats
    fetchStats();
});

const API_BASE_URL = window.location.protocol === 'file:' ? 'http://localhost:7005' : '';

async function fetchStats() {
    try {
        const res = await fetch(`${API_BASE_URL}/api/stats`);
        if (!res.ok) return; // Silent fail
        const data = await res.json();

        // Helper to animate/format numbers
        const animateValue = (id, value) => {
            const el = document.getElementById(id);
            if (!el) return;

            // formatting k/m
            let display = value;
            if (value >= 1000000) display = (value / 1000000).toFixed(1) + 'M';
            else if (value >= 1000) display = (value / 1000).toFixed(1) + 'k';

            el.innerText = display;
        };

        animateValue('stat-users', data.users);
        animateValue('stat-shows', data.showCount || 0);
        animateValue('stat-skips', data.skips);
        animateValue('stat-episodes', data.episodeCount || 0);

        // Saved Time
        const savedSec = data.savedTime || 0;
        let savedText = "0s";
        if (savedSec >= 86400) savedText = (savedSec / 86400).toFixed(1) + "d";
        else if (savedSec >= 3600) savedText = (savedSec / 3600).toFixed(1) + "h";
        else if (savedSec >= 60) savedText = (savedSec / 60).toFixed(0) + "m";
        else savedText = savedSec.toFixed(0) + "s";

        const savedEl = document.getElementById('stat-saved');
        if (savedEl) savedEl.innerText = savedText;

    } catch (e) {
        console.error("Stats error:", e);
    }
}
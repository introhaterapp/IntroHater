// Use current origin if served via http/s, fallback to production only if opening as a local file
// API_BASE_URL is defined in main.js

async function fetchCatalog() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/catalog`);
        if (!response.ok) {
            throw new Error('Failed to fetch catalog');
        }
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Error fetching catalog:', error);
        return { media: {} };
    }
}

async function fetchSegments(videoId) {
    try {
        const response = await fetch(`${API_BASE_URL}/api/segments/${videoId}`);
        if (!response.ok) throw new Error('Failed to fetch segments');
        return await response.json();
    } catch (error) {
        console.error('Error fetching segments:', error);
        return [];
    }
}

async function initializeCatalog() {
    const table = document.getElementById('catalogTable');
    if (!table) return;

    // Initialize DataTable immediately with empty data and loading state
    const dt = window.jQuery('#catalogTable').DataTable({
        data: [],
        responsive: {
            details: {
                type: 'column',
                target: 'tr',
                renderer: function (api, rowIdx, columns) {
                    const hiddenColumns = columns.filter(col => !col.visible);
                    if (!hiddenColumns.length) return false;

                    return window.jQuery('<table/>')
                        .addClass('table table-sm')
                        .append(hiddenColumns.map(col =>
                            window.jQuery('<tr/>')
                                .append(window.jQuery('<td/>').addClass('fw-bold').text(col.title + ':'))
                                .append(window.jQuery('<td/>').html(col.data))
                        ));
                }
            }
        },
        order: [[3, 'desc']], // Sort by segment count by default
        pageLength: 25,
        language: {
            emptyTable: "Loading catalog items... please wait.",
            processing: '<div class="spinner"></div>'
        },
        columns: [
            {
                title: 'Title',
                render: function (data, type, row) {
                    if (type === 'display') {
                        return `<span class="user-cell" style="font-size: 1rem;">${data}</span>`;
                    }
                    return data;
                }
            },
            {
                title: 'Year',
                className: 'min-tablet'
            },
            { title: 'Type' },
            {
                title: 'Segments',
                className: 'all text-right', // Changed to 'all' to force visibility on mobile
                render: function (data, type, row) {
                    if (type === 'display') {
                        // Index 0: Title, 1: Year, 2: Type, 3: Episodes Obj, 4: Count, 5: IMDb ID
                        const imdbId = row[5];
                        const count = row[4]; // Numeric count

                        // Always show view button if there are segments
                        if (count > 0) {
                            return `<button class="btn btn-secondary btn-sm episode-btn" 
                                    data-id="${imdbId}"
                                    data-title="${row[0]}">
                                    View ${count}
                                   </button>`;
                        } else {
                            return `<span class="text-muted">–</span>`;
                        }
                    }
                    return row[4];
                }
            }
        ],
        drawCallback: function () {
            // No longer attaching individual listeners here due to responsive rows re-rendering
        }
    });

    // Event Delegation for Button Clicks (Handles Buttons in Child Rows / Pagination)
    window.jQuery('#catalogTable').on('click', '.episode-btn', openSegmentModal);

    // Fetch and update data
    fetchCatalog().then(catalog => {
        const mediaEntries = catalog?.media ? Object.entries(catalog.media) : [];
        const tableData = mediaEntries
            .filter(([imdbId, media]) => {
                // Double check validity on frontend
                // Must have title AND more than 0 segments
                return media.title &&
                    media.title !== 'Unknown Title' &&
                    media.title !== 'null' &&
                    (media.totalSegments > 0);
            })
            .map(([imdbId, media]) => {
                return [
                    media.title || 'Unknown Title',
                    media.year || '????',
                    media.type === 'show' ? 'TV Show' : 'Movie',
                    media.episodes, // Store raw episodes object (hidden column effectively)
                    media.totalSegments || 0,
                    imdbId // Store ID for button
                ];
            });

        const dt = window.jQuery('#catalogTable').DataTable();
        dt.clear();
        dt.rows.add(tableData);
        dt.draw();

        if (tableData.length === 0) {
            dt.settings()[0].oLanguage.sEmptyTable = "No entries found in the catalog.";
            dt.draw();
        }
    });

    // Modal Logic
    const modal = document.getElementById('episodeModal');
    const closeBtn = document.getElementById('closeEpisodeModal');
    const closeBtn2 = document.getElementById('closeModalBtn');

    function closeModal() {
        modal.style.display = 'none';
    }

    if (closeBtn) closeBtn.onclick = closeModal;
    if (closeBtn2) closeBtn2.onclick = closeModal;
    window.onclick = function (event) {
        if (event.target == modal) {
            closeModal();
        }
    }
}

async function openSegmentModal(event) {
    const btn = event.currentTarget;
    const title = btn.dataset.title;
    const videoId = btn.dataset.id;

    const modalTitle = document.getElementById('modalTitle');
    const grid = document.getElementById('episodeGrid');

    modalTitle.textContent = `Loading segments for ${title}...`;
    grid.innerHTML = '<div style="text-align:center; padding: 20px;">Fetching latest data...</div>';

    // Ensure modal is visible and responsive
    const modal = document.getElementById('episodeModal');
    modal.style.display = 'flex';

    // Fix Layout: Override grid display so table takes full width
    grid.style.display = 'block';

    // Fetch details
    const rawSegments = await fetchSegments(videoId);

    modalTitle.textContent = `Segments: ${title}`;
    grid.innerHTML = '';

    if (rawSegments.length === 0) {
        grid.style.textAlign = 'center';
        grid.innerHTML = '<p style="text-align:center; color: var(--text-muted);">No segments found via API.</p>';
        return;
    }

    // Deduplicate
    const uniqueSegments = [];
    const seen = new Set();
    rawSegments.forEach(seg => {
        // Create a signature for the segment - Rounding for dedupe key
        const key = `${seg.videoId}|${Math.round(seg.start)}|${Math.round(seg.end)}`;
        if (!seen.has(key)) {
            seen.add(key);
            uniqueSegments.push(seg);
        }
    });

    // Wrapper for mobile horizontal scrolling
    const tableWrapper = document.createElement('div');
    tableWrapper.style.overflowX = 'auto';
    tableWrapper.style.width = '100%';
    tableWrapper.style.webkitOverflowScrolling = 'touch'; // Smooth scroll on iOS

    // Wrap in a table for better view
    const table = document.createElement('table');
    table.className = 'table';
    table.style.width = '100%';
    table.style.fontSize = '0.9rem';
    table.style.minWidth = '500px'; // Force min width to trigger scroll on small phones if needed

    let html = `
        <thead>
            <tr style="color: var(--text-muted); text-align: left;">
                <th>Episode</th>
                <th>Time (Start - End)</th>
                <th>Type</th>
            </tr>
        </thead>
        <tbody>
    `;

    // Sort: Season -> Episode -> StartTime
    uniqueSegments.sort((a, b) => {
        // Parse "S1:E1" from videoId if possible, else just title
        // Actually the API returns segments with 'videoId' like 'tt123456:1:1'
        // Let's try to extract season/ep
        const getSE = (vid) => {
            const parts = vid.split(':');
            if (parts.length >= 3) return { s: parseInt(parts[1]), e: parseInt(parts[2]) };
            return { s: 0, e: 0 };
        };

        const seA = getSE(a.videoId);
        const seB = getSE(b.videoId);

        if (seA.s !== seB.s) return seA.s - seB.s;
        if (seA.e !== seB.e) return seA.e - seB.e;
        return a.start - b.start;
    });

    uniqueSegments.forEach(seg => {
        const parts = seg.videoId.split(':');
        let label = "Common";

        // Robust S/E parsing
        if (parts.length >= 3) {
            const s = parseInt(parts[1]);
            const e = parseInt(parts[2]);
            if (!isNaN(s) && !isNaN(e)) {
                label = `S${s}E${e}`;
            }
        }

        // If label is still default (Common), try to guess checking if btn has type
        // But for now "Common" or "Series Skip" is safest if it's a show
        if (label === 'Common' && parts.length === 1) {
            label = 'Global';
        }


        const duration = Math.round(seg.end - seg.start);
        const start = Math.round(seg.start);
        const end = Math.round(seg.end);

        // Use seg.label (e.g. "Intro") instead of category
        const typeLabel = seg.label || seg.category || 'Intro';

        html += `
            <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
                <td><span class="badge" style="background: rgba(255,255,255,0.1);">${label}</span></td>
                <td>${start}s - ${end}s <span style="color:var(--text-muted); font-size:0.8em">(${duration}s)</span></td>
                <td>${typeLabel}</td>
            </tr>
        `;
    });

    html += '</tbody>';
    table.innerHTML = html;

    tableWrapper.appendChild(table);
    grid.appendChild(tableWrapper);
}

document.addEventListener('DOMContentLoaded', initializeCatalog);
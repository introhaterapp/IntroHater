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
                className: 'min-tablet text-right',
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
            // Re-attach listeners after draw
            const btns = document.querySelectorAll('.episode-btn');
            btns.forEach(btn => {
                // Remove old listener to be safe (though drawCallback usually runs on fresh elements)
                btn.removeEventListener('click', openSegmentModal);
                btn.addEventListener('click', openSegmentModal);
            });
        }
    });

    // Fetch and update data
    fetchCatalog().then(catalog => {
        const mediaEntries = catalog?.media ? Object.entries(catalog.media) : [];
        const tableData = mediaEntries
            .filter(([imdbId, media]) => {
                // Double check validity on frontend
                return media.title && media.title !== 'Unknown Title' && media.title !== 'null';
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
    document.getElementById('episodeModal').style.display = 'flex';

    // Fetch details
    const segments = await fetchSegments(videoId);

    modalTitle.textContent = `Segments: ${title}`;
    grid.innerHTML = '';

    if (segments.length === 0) {
        grid.innerHTML = '<p style="text-align:center; color: var(--text-muted);">No segments found via API.</p>';
        return;
    }

    // Wrap in a table for better view
    const table = document.createElement('table');
    table.className = 'table';
    table.style.width = '100%';
    table.style.fontSize = '0.9rem';

    let html = `
        <thead>
            <tr style="color: var(--text-muted); text-align: left;">
                <th>Episode</th>
                <th>Time (Start - End)</th>
                <th>Type</th>
                <th>Author</th>
            </tr>
        </thead>
        <tbody>
    `;

    // Sort: Season -> Episode -> StartTime
    segments.sort((a, b) => {
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

    segments.forEach(seg => {
        const parts = seg.videoId.split(':');
        let label = "Movie";
        if (parts.length >= 3) {
            label = `S${parts[1]}E${parts[2]}`;
        }

        const duration = (seg.end - seg.start).toFixed(1);
        const author = seg.contributorId ? seg.contributorId.substring(0, 6) : 'System';

        html += `
            <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
                <td><span class="badge" style="background: rgba(255,255,255,0.1);">${label}</span></td>
                <td>${seg.start}s - ${seg.end}s <span style="color:var(--text-muted); font-size:0.8em">(${duration}s)</span></td>
                <td>${seg.category}</td>
                <td title="${seg.contributorId}">${author}</td>
            </tr>
        `;
    });

    html += '</tbody>';
    table.innerHTML = html;
    grid.appendChild(table);
}

document.addEventListener('DOMContentLoaded', initializeCatalog);
// Use current origin if served via http/s, fallback to production only if opening as a local file
// API_BASE_URL is defined in main.js

// async function fetchCatalog() { ... } (Removed as unused)

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

    // Initialize DataTable with server-side processing
    window.jQuery('#catalogTable').DataTable({
        serverSide: true,
        ajax: {
            url: `${API_BASE_URL}/api/catalog`,
            type: 'GET',
            dataSrc: 'data'
        },
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
        order: [[0, 'asc']], // Sort by Title by default
        pageLength: 25,
        language: {
            emptyTable: "No entries found in the catalog.",
            processing: '<div class="spinner"></div>'
        },
        columns: [
            {
                title: 'Title',
                data: 0,
                render: function (data, type, _row) {
                    if (type === 'display') {
                        return `<span class="user-cell" style="font-size: 1rem;">${data}</span>`;
                    }
                    return data;
                }
            },
            {
                title: 'Year',
                data: 1,
                className: 'min-tablet',
                width: '100px'
            },
            {
                title: 'Segments',
                data: 3, // Use the totalSegments count for sorting/filtering
                className: 'all text-right',
                width: '140px',
                render: function (data, type, row) {
                    if (type === 'display') {
                        const imdbId = row[4];
                        const count = data;

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
                    return data;
                }
            }
        ],
        drawCallback: function () {
            // No longer attaching individual listeners here due to responsive rows re-rendering
        }
    });

    // Event Delegation for Button Clicks (Handles Buttons in Child Rows / Pagination)
    window.jQuery('#catalogTable').on('click', '.episode-btn', openSegmentModal);
}

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

async function openSegmentModal(event) {
    const btn = event.currentTarget;
    const title = btn.dataset.title;
    const videoId = btn.dataset.id;

    const modalTitle = document.getElementById('modalTitle');
    const grid = document.getElementById('episodeGrid');

    modalTitle.textContent = `Segments: ${title}`;
    grid.innerHTML = `<div style="padding: 20px;">${window.createSkeleton('text', 5)}</div>`;

    // Ensure modal is visible and responsive
    const modal = document.getElementById('episodeModal');
    modal.style.display = 'flex';

    // Fix Layout: Override grid display so table takes full width
    grid.style.display = 'block';

    // Fetch details
    const rawSegments = await fetchSegments(videoId);

    // Display details
    const uniqueSegments = rawSegments; // Already deduplicated and rounded on server

    modalTitle.textContent = `Segments: ${title}`;
    grid.innerHTML = '';

    if (uniqueSegments.length === 0) {
        grid.style.textAlign = 'center';
        grid.innerHTML = '<p style="text-align:center; color: var(--text-muted);">No segments found via API.</p>';
        return;
    }

    // Sort: Season -> Episode -> StartTime
    uniqueSegments.sort((a, b) => {
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

    const displaySegments = uniqueSegments.slice(0, 500);

    // Wrapper for mobile horizontal scrolling
    const tableWrapper = document.createElement('div');
    tableWrapper.style.overflowX = 'auto';
    tableWrapper.style.width = '100%';
    tableWrapper.style.webkitOverflowScrolling = 'touch';

    const table = document.createElement('table');
    table.className = 'table';
    table.style.width = '100%';
    table.style.fontSize = '0.9rem';
    table.style.minWidth = '500px';

    let html = `
        <thead>
            <tr style="color: var(--text-muted); text-align: left;">
                <th>Episode</th>
                <th>Time (Start - End)</th>
            </tr>
        </thead>
        <tbody>
    `;

    displaySegments.forEach(seg => {
        const parts = seg.videoId.split(':');
        let label = "Common";

        if (parts.length >= 3) {
            const s = parseInt(parts[1]);
            const e = parseInt(parts[2]);
            if (!isNaN(s) && !isNaN(e)) {
                label = `S${s}E${e}`;
            }
        }

        if (label === 'Common' && parts.length === 1) {
            label = 'Global';
        }

        const duration = seg.end - seg.start;
        html += `
            <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
                <td><span class="badge" style="background: rgba(255,255,255,0.1);">${label}</span></td>
                <td>${seg.start}s - ${seg.end}s <span style="color:var(--text-muted); font-size:0.8em">(${duration}s)</span></td>
            </tr>
        `;
    });

    html += '</tbody>';
    table.innerHTML = html;

    tableWrapper.appendChild(table);
    grid.appendChild(tableWrapper);

    if (uniqueSegments.length > 500) {
        const note = document.createElement('p');
        note.style.textAlign = 'center';
        note.style.fontSize = '0.8rem';
        note.style.color = 'var(--text-muted)';
        note.style.marginTop = '10px';
        note.textContent = `Showing first 500 of ${uniqueSegments.length} segments.`;
        grid.appendChild(note);
    }
}

document.addEventListener('DOMContentLoaded', initializeCatalog);
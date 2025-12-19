// Use current origin if served via http/s, fallback to production only if opening as a local file
const API_BASE_URL = window.location.protocol === 'file:' ? 'https://introhater.com' : '';

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
        order: [[0, 'asc']],
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
                        // Index 4 is Total Segments display
                        // Index 3 is Episodes object
                        // Index 2 is Type
                        if (row[2] === 'TV Show' && row[3]) {
                            const episodesData = JSON.stringify(row[3]).replace(/"/g, '&quot;');
                            return `<button class="btn btn-secondary episode-btn" 
                                    data-title="${row[0]}" 
                                    data-episodes='${episodesData}'>
                                    View
                                   </button>`;
                        } else {
                            return `<span class="text-muted font-weight-bold">${row[4]}</span>`;
                        }
                    }
                    return row[4];
                }
            }
        ],
        drawCallback: function () {
            document.querySelectorAll('.episode-btn').forEach(btn => {
                btn.addEventListener('click', openEpisodeModal);
            });
        }
    });

    // Fetch and update data
    fetchCatalog().then(catalog => {
        const mediaEntries = catalog?.media ? Object.entries(catalog.media) : [];
        const tableData = mediaEntries.map(([, media]) => {
            return [
                media.title,
                media.year,
                media.type === 'show' ? 'TV Show' : 'Movie',
                media.type === 'show' ? media.episodes : null,
                `<span class="segment-count">${media.totalSegments} segment${media.totalSegments !== 1 ? 's' : ''}</span>`
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

function openEpisodeModal(event) {
    const btn = event.currentTarget;
    const title = btn.dataset.title;
    const episodes = JSON.parse(btn.dataset.episodes);

    document.getElementById('modalTitle').textContent = `Segments for ${title}`;

    const grid = document.getElementById('episodeGrid');
    grid.innerHTML = '';

    // Sort episodes
    const sortedEpisodes = Object.entries(episodes)
        .map(([, ep]) => ({
            season: ep.season,
            episode: ep.episode
        }))
        .sort((a, b) => {
            if (a.season !== b.season) return a.season - b.season;
            return a.episode - b.episode;
        });

    sortedEpisodes.forEach(ep => {
        const chip = document.createElement('div');
        chip.className = 'episode-chip';
        chip.textContent = `S${ep.season.toString().padStart(2, '0')}E${ep.episode.toString().padStart(2, '0')}`;
        grid.appendChild(chip);
    });

    document.getElementById('episodeModal').style.display = 'flex';
}

document.addEventListener('DOMContentLoaded', initializeCatalog);
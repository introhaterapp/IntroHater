const catalogService = require('./catalog');
const skipService = require('./skip-service');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

const STATE_FILE = path.join(__dirname, '../../data/indexer_state.json');

class IndexerService {
    constructor() {
        this.isRunning = false;
        this.interval = 12 * 60 * 60 * 1000; // 12 Hours
    }

    start() {
        // Run immediately on start
        this.runIndex();

        // Schedule periodic runs
        setInterval(() => this.runIndex(), this.interval);
    }

    async loadState() {
        try {
            const data = await fs.readFile(STATE_FILE, 'utf8');
            return JSON.parse(data);
        } catch (e) {
            return { page: 0, offset: 0, lastRun: null };
        }
    }

    async saveState(state) {
        try {
            await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });
            await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2));
        } catch (e) {
            console.error('[Indexer] Failed to save state:', e.message);
        }
    }

    async runIndex() {
        if (this.isRunning) {
            console.log('[Indexer] Already running, skipping cycle.');
            return;
        }

        this.isRunning = true;

        // Load State
        const state = await this.loadState();
        console.log(`[Indexer] Starting catalog indexing cycle (Resuming from Page ${state.page})...`);

        try {
            await this.indexAnimeSkipCatalog(state);
        } catch (e) {
            console.error(`[Indexer] Cycle failed: ${e.message}`);
        } finally {
            this.isRunning = false;
            console.log('[Indexer] Indexing cycle complete.');
        }
    }

    async indexAnimeSkipCatalog(initialState) {
        const ANIME_SKIP_CLIENT_ID = 'th2oogUKrgOf1J8wMSIUPV0IpBMsLOJi';
        const BATCH_SIZE = 50;
        const MAX_PAGES = 100; // Increased limit to cover more shows over time

        let offset = initialState.offset || 0;
        let page = initialState.page || 0;
        let running = true;

        while (running && page < MAX_PAGES) {
            try {
                // Query Anime-Skip to find shows.
                const query = `
                    query ($search: String!, $offset: Int, $limit: Int) {
                        searchShows(search: $search, offset: $offset, limit: $limit) {
                            id
                            name
                            externalLinks {
                                service
                                url
                            }
                        }
                    }
                `;

                const res = await axios.post('https://api.anime-skip.com/graphql', {
                    query,
                    variables: { search: " ", offset, limit: BATCH_SIZE }
                }, { headers: { 'X-Client-ID': ANIME_SKIP_CLIENT_ID } });

                const shows = res.data?.data?.searchShows || [];

                if (shows.length === 0) {
                    console.log('[Indexer] No more shows found (empty result). Resetting indexer loop.');
                    await this.saveState({ page: 0, offset: 0, lastRun: new Date().toISOString() });
                    running = false;
                    break;
                }

                console.log(`[Indexer] Processing page ${page + 1} (Offset: ${offset}, Shows: ${shows.length})...`);

                for (const show of shows) {
                    let imdbId = null;
                    // Try to find IMDB ID in external Links
                    if (show.externalLinks) {
                        const imdbLink = show.externalLinks.find(e => e.service === 'IMDB' || (e.url && e.url.includes('imdb.com/title/')));
                        if (imdbLink && imdbLink.url) {
                            // Extract tt123456
                            const match = imdbLink.url.match(/(tt\d+)/);
                            if (match) imdbId = match[1];
                        }
                    }

                    // Fallback: Search Cinemeta by Name
                    if (!imdbId && show.name) {
                        try {
                            const searchUrl = `https://v3-cinemeta.strem.io/catalog/series/top/search=${encodeURIComponent(show.name)}.json`;
                            const searchRes = await axios.get(searchUrl);
                            if (searchRes.data?.metas?.length > 0) {
                                imdbId = searchRes.data.metas[0].id;
                                // console.log(`[Indexer] Mapped "${show.name}" -> ${imdbId}`);
                            }
                        } catch (e) { }
                    }

                    // If registered, add to catalog AND fetch segments
                    if (imdbId) {
                        // console.log(`[Indexer] Found IMDb ID: ${imdbId} (${show.name}). Fetching segments...`);
                        await catalogService.registerShow(imdbId);

                        // --- FETCH SEGMENTS ---
                        try {
                            const epQuery = `
                                query ($showId: ID!) {
                                    findEpisodesByShowId(showId: $showId) {
                                        number
                                        season
                                        timestamps {
                                            at
                                            type {
                                                name
                                            }
                                        }
                                    }
                                }
                            `;
                            const epRes = await axios.post('https://api.anime-skip.com/graphql', {
                                query: epQuery,
                                variables: { showId: show.id }
                            }, { headers: { 'X-Client-ID': ANIME_SKIP_CLIENT_ID } });


                            const episodes = epRes.data?.data?.findEpisodesByShowId || [];
                            let importedCount = 0;

                            for (const ep of episodes) {
                                const timestamps = ep.timestamps || [];
                                const intro = timestamps.find(t => t.type.name.toLowerCase().includes('opening') || t.type.name.toLowerCase().includes('intro'));

                                if (intro) {
                                    const currentIndex = timestamps.indexOf(intro);
                                    const next = timestamps[currentIndex + 1];
                                    const start = intro.at;
                                    const end = next ? next.at : start + 90;

                                    // Construct ID: tt123456:1:5 (Dynamic season from API)
                                    const season = ep.season || 1;
                                    const fullId = `${imdbId}:${season}:${ep.number}`;

                                    // Use new duplicate-safe add method
                                    await skipService.addSkipSegment(fullId, start, end, 'Intro', 'auto-import', false, true); // skipSave = true

                                    importedCount++;
                                }
                            }

                            if (importedCount > 0) {
                                console.log(`[Indexer] Imported ${importedCount} segments for ${show.name} (${imdbId})`);
                            }

                        } catch (err) {
                            console.error(`[Indexer] Failed to fetch segments for ${show.name}: ${err.message}`);
                        }

                    } else {
                        // console.log(`[Indexer] No IMDb ID for show: ${show.name}`);
                    }

                    // Throttle inner loop slightly to avoid hammer
                    await new Promise(r => setTimeout(r, 200));
                }

                // Save after batch
                await skipService.forceSave();

                offset += BATCH_SIZE;
                page++;

                // Save State Checkpoint
                await this.saveState({ page, offset, lastRun: new Date().toISOString() });

                // Throttle to avoid rate limits
                await new Promise(r => setTimeout(r, 1000));

            } catch (e) {
                console.error(`[Indexer] Error on page ${page}: ${e.message}`);
                // Save state even on error to resume later
                await this.saveState({ page, offset, error: e.message, lastRun: new Date().toISOString() });
                running = false;
            }
        }
    }
}

module.exports = new IndexerService();
